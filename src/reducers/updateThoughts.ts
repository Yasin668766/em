import _ from 'lodash'
import Index from '../@types/IndexType'
import Lexeme from '../@types/Lexeme'
import Path from '../@types/Path'
import PushBatch from '../@types/PushBatch'
import SimplePath from '../@types/SimplePath'
import State from '../@types/State'
import Thought from '../@types/Thought'
import { ABSOLUTE_TOKEN, EM_TOKEN, HOME_TOKEN, MAX_JUMPS } from '../constants'
import { editThoughtPayload } from '../reducers/editThought'
import expandThoughts from '../selectors/expandThoughts'
import { getLexeme } from '../selectors/getLexeme'
import getThoughtById from '../selectors/getThoughtById'
import pathToThought from '../selectors/pathToThought'
import rootedParentOf from '../selectors/rootedParentOf'
import thoughtToPath from '../selectors/thoughtToPath'
import equalPath from '../util/equalPath'
import head from '../util/head'
import logWithTime from '../util/logWithTime'
import mergeUpdates from '../util/mergeUpdates'
import parentOf from '../util/parentOf'
import reducerFlow from '../util/reducerFlow'

/** A reducer that prepends the cursor to the the jump history. If the cursor is the same as the last jump point, does nothing. If the cursor is adjacent to the last jump point (parent, child, or sibling of), then it replaces the last jump point. See reducers/jump.ts and State.jumpHistory. */
const updateJumpHistory = (state: State): State => {
  const lastJump = state.jumpHistory[0]
  const lastJumpParent = lastJump ? parentOf(lastJump) : null
  const cursorParent = state.cursor ? parentOf(state.cursor) : null

  /** Returns true if the cursor is the parent, child, or sibling of the last jump point. When this is true, the cursor will replace the last jump history entry rather than appending to it, thus preserving only the last edit cursor among a group of proximal edits. */
  const isAdjacent = () =>
    !!state.cursor &&
    state.cursor.length > 0 &&
    !!lastJump &&
    lastJump.length > 0 &&
    // parent
    (equalPath(lastJumpParent, state.cursor) ||
      // child
      equalPath(lastJump, cursorParent) ||
      // sibling
      equalPath(lastJumpParent, cursorParent))

  // append old cursor to jump history if different
  // replace last jump if adjacent
  // limit to MAX_JUMPS
  // See: State.jumpHistory
  return lastJump !== state.cursor
    ? {
        ...state,
        jumpHistory: [state.cursor, ...state.jumpHistory.slice(isAdjacent() ? 1 : 0, MAX_JUMPS)],
        jumpIndex: 0,
      }
    : state
}

export type UpdateThoughtsOptions = PushBatch & {
  contextChain?: SimplePath[]
  isLoading?: boolean
  pendingEdits?: editThoughtPayload[]
  // By default, thoughts will be re-expanded with the fresh state. If a separate expandThoughts is called after updateThoughts within the same reducerFlow, then we can prevent expandThoughts here for better performance. See moveThought.
  preventExpandThoughts?: boolean
  // If true, check if the cursor is valid, and if not, move it to the closest valid ancestor.
  // This should only be used when the updates are coming from another device. For local updates, updateThoughts is typically called within a higher level reducer (e.g. moveThought) which handles all cursor updates. There would be false positives during local updates since the cursor is updated after updateThoughts.
  repairCursor?: boolean
}

/** A reducer that repairs the cursor if it moved or was deleted. */
const repairCursorReducer = (state: State) => {
  if (!state.cursor) return state

  let cursorNew: Path | null = state.cursor
  const cursorThought = pathToThought(state, state.cursor)

  // cursor was moved but still exists
  // update the cursor to the new path
  if (cursorThought) {
    const recalculatedCursor = thoughtToPath(state, head(state.cursor))
    if (!_.isEqual(recalculatedCursor, state.cursor)) {
      cursorNew = recalculatedCursor
    }
  }
  // cursor was removed
  // find the closest existent ancestor
  else {
    const closestAncestorIndex = state.cursor.findIndex((id, i) => {
      const ancestorPath = state.cursor!.slice(0, i + 1) as Path
      const thought = pathToThought(state, ancestorPath)
      return !thought || thought.parentId !== head(rootedParentOf(state, ancestorPath))
    })
    cursorNew = closestAncestorIndex > 0 ? (state.cursor.slice(0, closestAncestorIndex) as Path) : null
  }

  return {
    ...state,
    cursor: cursorNew,
  }
}

/** Creates a reducer spy that throws an error if any data integrity issues are found, including invalid parentIds and missing Lexemes. */
const dataIntegrityCheck =
  (thoughtIndexUpdates: Index<Thought | null>, lexemeIndexUpdates: Index<Lexeme | null>) => (state: State) => {
    // undefined thought value
    Object.entries(thoughtIndexUpdates).forEach(([id, thought]) => {
      if (!thought) return
      if (thought.value == null) {
        console.error('id', id)
        console.error('thought', thought)
        throw new Error('Missing thought value')
      }
    })

    Object.values(thoughtIndexUpdates).forEach(thought => {
      if (!thought) return

      // disallow children property
      if ('children' in thought) {
        console.error('thought', thought)
        throw new Error(
          'Thoughts in State should not have children property. Only the database should contain inline children.',
        )
      }

      // make sure thought.parentId exists in thoughtIndex
      if (
        ![HOME_TOKEN, EM_TOKEN, ABSOLUTE_TOKEN].includes(thought.id) &&
        !getThoughtById(state, thought.parentId) &&
        // Unfortunately 2-part deletes produce false positives of invalid parentId.
        // False positives occur in Part II, so we can't check pendingDeletes (it has already been flushed).
        // Instead, check the undo patch and disable the check if the last action is deleteThought or deleteThoughtWithCursor.
        // It's hacky, but it seems better than omitting the check completely.
        // If we get more false positives or false negatives, we can adjust the condition.
        !state.undoPatches[state.undoPatches.length - 1]?.[0].actions[0]?.startsWith('deleteThought')
      ) {
        console.error('thought', thought)
        throw new Error(`Parent ${thought.parentId} of ${thought.value} (${thought.id}) does not exist`)
      }

      // make sure thought's children's parentId matches the thought's id.
      const children = Object.values(thought.childrenMap || {})
        .map(id => getThoughtById(state, id))
        // the child may not exist in the thoughtIndex yet if it is pending
        .filter(Boolean)
      children.forEach(child => {
        if (child.parentId !== thought.id) {
          console.error('child', child)
          console.error('thought', thought)
          throw new Error('child.parentId !== thought.id')
        }
      })

      // assert that a lexeme exists for the thought
      const lexeme = getLexeme(state, thought.value)
      if (!lexeme) {
        console.error('thought', thought)
        throw new Error(`Thought "${thought.value}" (${thought.id}) is missing a corresponding Lexeme.`)
      } else if (
        ![HOME_TOKEN, EM_TOKEN, ABSOLUTE_TOKEN].includes(thought.id) &&
        !lexeme.contexts.some(cx => cx === thought.id)
      ) {
        console.error('lexemeIndexUpdates', lexemeIndexUpdates)
        console.error('thoughtIndexUpdates', thoughtIndexUpdates)
        console.error('thought', thought)
        console.error('lexeme', lexeme)
        throw new Error(`Thought "${thought.value}" (${thought.id}) is missing from its Lexeme's contexts.`)
      } else if (Array.from(lexeme as any).length === 21) {
        throw new Error(`Lexeme has been converted to an array? That can't be right.`)
      }
    })

    return state
  }

/** Returns true if a non-root context begins with HOME_TOKEN. Used as a data integrity check. */
// const isInvalidContext = (state: State, cx: ThoughtContext) => {
//   cx && cx.context && cx.context[0] === HOME_TOKEN && cx.context.length > 1
// }

/**
 * Updates lexemeIndex and thoughtIndex with any number of thoughts.
 *
 * @param local    If false, does not persist to local database. Default: true.
 * @param remote   If false, does not persist to remote database. Default: true.
 */
const updateThoughts = (
  state: State,
  {
    lexemeIndexUpdates,
    thoughtIndexUpdates,
    recentlyEdited,
    updates,
    pendingDeletes,
    pendingLexemes,
    preventExpandThoughts,
    local = true,
    remote = true,
    isLoading,
    repairCursor,
  }: UpdateThoughtsOptions,
) => {
  if (Object.keys(thoughtIndexUpdates).length === 0 && Object.keys(lexemeIndexUpdates).length === 0) return state

  const thoughtIndexOld = { ...state.thoughts.thoughtIndex }
  const lexemeIndexOld = { ...state.thoughts.lexemeIndex }

  const thoughtIndex = mergeUpdates(thoughtIndexOld, thoughtIndexUpdates)
  const lexemeIndex = mergeUpdates(lexemeIndexOld, lexemeIndexUpdates)

  const recentlyEditedNew = recentlyEdited || state.recentlyEdited

  // lexemes from the updates that are not available in the state yet
  // pull pending Lexemes when updates are being saved to local and remote, i.e. user edits, not updates from pull
  const pendingLexemesUpdated =
    local && remote
      ? Object.keys(lexemeIndexUpdates).reduce<Index<boolean>>((acc, thoughtId) => {
          const lexemeInState = state.thoughts.lexemeIndex[thoughtId]
          return {
            ...acc,
            ...(lexemeInState ? {} : { [thoughtId]: true }),
          }
        }, {})
      : {}

  // updates are queued, detected by the pushQueue middleware, and sync'd with the local and remote stores
  const batch: PushBatch = {
    lexemeIndexUpdates,
    local,
    pendingDeletes,
    pendingLexemes: { ...pendingLexemesUpdated, ...pendingLexemes },
    recentlyEdited: recentlyEditedNew,
    remote,
    thoughtIndexUpdates: thoughtIndexUpdates,
    updates,
  }

  logWithTime('updateThoughts: merge pushQueue')

  /** Returns false if the root thought is loaded and not pending. */
  const isStillLoading = () => {
    const rootThought = thoughtIndexUpdates[HOME_TOKEN] || (thoughtIndex[HOME_TOKEN] as Thought | null)
    const thoughtsLoaded =
      rootThought &&
      !rootThought.pending &&
      // Disable isLoading if the root children have been loaded.
      // Otherwise NoThoughts will still be shown since there are no children to render.
      // If the root has no children and is no longer pending, we can disable isLoading immediately.
      (Object.keys(rootThought.childrenMap).length === 0 ||
        Object.values(rootThought.childrenMap).find(childId => thoughtIndex[childId]))
    return isLoading ?? !thoughtsLoaded
  }

  return reducerFlow([
    // update recentlyEdited, pushQueue, and thoughts
    state => ({
      ...state,
      // disable loading screen as soon as the root is loaded
      // or isLoading can be forced by passing it directly to updateThoughts
      isLoading: state.isLoading && isStillLoading(),
      recentlyEdited: recentlyEditedNew,
      // only push the batch to the pushQueue if syncing at least local or remote
      ...(batch.local || batch.remote ? { pushQueue: [...state.pushQueue, batch] } : null),
      thoughts: {
        thoughtIndex,
        lexemeIndex,
      },
    }),

    // Repair cursor
    // When getting updates from another device, the cursor may have moved or no longer exist, and needs to be updated.
    repairCursor ? repairCursorReducer : null,

    // expandThoughts
    state => {
      return {
        ...state,
        // calculate expanded using fresh thoughts and cursor
        ...(!preventExpandThoughts ? { expanded: expandThoughts(state, state.cursor) } : null),
      }
    },

    updateJumpHistory,

    // data integrity checks
    // immediately throws if any data integity issues are found
    // otherwise noop
    state => {
      dataIntegrityCheck(thoughtIndexUpdates, lexemeIndexUpdates)
      return state
    },
  ])(state)
}

export default _.curryRight(updateThoughts)
