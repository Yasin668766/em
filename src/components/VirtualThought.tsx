import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { shallowEqual, useSelector } from 'react-redux'
import Autofocus from '../@types/Autofocus'
import LazyEnv from '../@types/LazyEnv'
import Path from '../@types/Path'
import SimplePath from '../@types/SimplePath'
import State from '../@types/State'
import ThoughtId from '../@types/ThoughtId'
import useChangeRef from '../hooks/useChangeRef'
import useDelayedAutofocus from '../hooks/useDelayedAutofocus'
import useSelectorEffect from '../hooks/useSelectorEffect'
import attribute from '../selectors/attribute'
import calculateAutofocus from '../selectors/calculateAutofocus'
import findDescendant from '../selectors/findDescendant'
import { findAnyChild } from '../selectors/getChildren'
import getContexts from '../selectors/getContexts'
import getStyle from '../selectors/getStyle'
import getThoughtById from '../selectors/getThoughtById'
import isContextViewActive from '../selectors/isContextViewActive'
import store from '../stores/app'
import editingValueStore from '../stores/editingValue'
import equalPath from '../util/equalPath'
import head from '../util/head'
import isAttribute from '../util/isAttribute'
import isDescendantPath from '../util/isDescendantPath'
import once from '../util/once'
import DropBefore from './DropBefore'
import DropEmpty from './DropEmpty'
import NoOtherContexts from './NoOtherContexts'
import Thought from './Thought'

/** Finds the the first env entry with =focus/Zoom. O(children). */
const findFirstEnvContextWithZoom = (state: State, { id, env }: { id: ThoughtId; env?: LazyEnv }): ThoughtId | null => {
  if (!env) return null
  const child = findAnyChild(
    state,
    id,
    child => isAttribute(child.value) && attribute(state, env[child.value], '=focus') === 'Zoom',
  )
  return child ? findDescendant(state, env[child.value], ['=focus', 'Zoom']) : null
}

/** Renders a thought if it is not hidden by autofocus, otherwise renders a fixed height shim. */
const VirtualThought = ({
  debugIndex,
  depth,
  dropBefore,
  env,
  indexDescendant,
  isMultiColumnTable,
  leaf,
  path,
  prevChildId,
  onResize,
  showContexts,
  simplePath,
  style,
  zoomCursor,
}: {
  debugIndex?: number
  depth: number
  dropBefore?: boolean
  env?: LazyEnv
  indexDescendant: number
  isMultiColumnTable?: boolean
  leaf: boolean
  path: Path
  prevChildId?: ThoughtId
  onResize?: (id: ThoughtId, height: number | null) => void
  showContexts?: boolean
  simplePath: SimplePath
  style?: React.CSSProperties
  zoomCursor?: boolean
}) => {
  const thought = useSelector((state: State) => getThoughtById(state, head(simplePath)), shallowEqual)
  const isEditing = useSelector((state: State) => equalPath(state.cursor, simplePath))
  const heightRef = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  /***************************
   * VirtualThought properties

   ***************************/

  // Hidden thoughts can be removed completely as long as the container preserves its height (to avoid breaking the scroll position).
  // Wait until the fade out animation has completed before removing.
  // Only shim 'hide', not 'hide-parent', thoughts, otherwise hidden parents snap in instead of fading in when moving up the tree.
  const autofocus = useSelector(calculateAutofocus(path))
  const shimHiddenThought = useDelayedAutofocus(autofocus, {
    delay: 750,
    selector: (autofocusAfterAnimation: Autofocus) =>
      autofocus === 'hide' && autofocusAfterAnimation === 'hide' && !!heightRef.current,
  })

  // console.info('<VirtualThought>', prettyPath(childPath))
  // useWhyDidYouUpdate('<VirtualThought> ' + prettyPath(state, childPath), {
  //   child,
  //   depth,
  //   env,
  //   index,
  //   isHeader,
  //   isMultiColumnTable,
  //   zoomCursor,
  //   path,
  //   prevChildId,
  //   shimHiddenThought
  //   showContexts,
  //   // hooks
  //   childPathUnstable,
  //   childPath,
  // })

  const updateHeight = useCallback(() => {
    if (!ref.current) return
    const heightNew = ref.current.clientHeight
    if (heightNew === heightRef.current) return
    heightRef.current = ref.current.clientHeight
    onResize?.(thought.id, heightRef.current)
  }, [])

  // Read the element's height from the DOM on cursor change, but do not re-render.
  // shimHiddenThought will re-render as needed.
  useSelectorEffect((state: State) => state.cursor?.length, updateHeight, shallowEqual)
  useEffect(updateHeight)

  // Recalculate height on edit
  useEffect(() => {
    updateHeight()
    if (isEditing) {
      // update height when editingValue changes and return the unsubscribe function
      return editingValueStore.subscribe(updateHeight)
    }
  }, [isEditing])

  // trigger onResize with null to allow subscribes to clean up
  useEffect(() => {
    return () => {
      onResize?.(thought.id, null)
    }
  }, [])

  // Short circuit if thought has already been removed.
  // This can occur in a re-render even when thought is defined in the parent component.
  if (!thought) return null

  const isVisible = zoomCursor || autofocus === 'show' || autofocus === 'dim'

  return (
    <div
      ref={ref}
      style={{
        // Fix the height of the container to the last measured height to ensure that there is no layout shift when the Thought is removed from the DOM.
        // Must include DropEmpty, or it will shift when the cursor moves.
        height: shimHiddenThought ? heightRef.current! : undefined,
      }}
    >
      {
        /* Since no drop target is rendered when thoughts are hidden/shimmed, we need to create a drop target for after a hidden parent.
           e.g. Below, a is hidden and all of b's siblings are hidden, but we still want to be able to drop before e. Therefore we insert DropHiddenUncle when e would not be rendered.
             - a
              - b
                - c [cursor]
                  - x
                - d
              - e
         */
        !isVisible && dropBefore && <DropBefore depth={depth} simplePath={simplePath} />
      }

      {!shimHiddenThought && (
        <Subthought
          autofocus={autofocus}
          debugIndex={debugIndex}
          depth={depth + 1}
          dropBefore={dropBefore}
          env={env}
          indexDescendant={indexDescendant}
          isMultiColumnTable={isMultiColumnTable}
          leaf={leaf}
          path={path}
          prevChildId={prevChildId}
          showContexts={showContexts}
          simplePath={simplePath}
          style={style}
          zoomCursor={zoomCursor}
        />
      )}

      {isVisible && (
        <DropEmpty
          depth={depth}
          indexDescendant={indexDescendant}
          leaf={leaf}
          // In context view, we need to pass the source simplePath in order to add dragged thoughts to the correct lexeme instance.
          // For example, when dropping a thought onto a/m~/b, drop should be triggered with the props of m/b.
          // TODO: DragAndDropSubthoughts should be able to handle this.
          path={path}
          simplePath={simplePath}
          showContexts={showContexts}
        />
      )}
    </div>
  )
}

const VirtualThoughtMemo = React.memo(VirtualThought)
VirtualThoughtMemo.displayName = 'VirtualThought'

/** Renders a thought with style. */
// TODO: These selectors can be optimized by calculating them once for all children, since they are the same among siblings. However siblings are not rendered contiguously (virtualTree), so they need to be calculated higher up.
const Subthought = ({
  autofocus,
  debugIndex,
  depth,
  dropBefore,
  env,
  indexDescendant,
  isMultiColumnTable,
  leaf,
  path,
  prevChildId,
  showContexts,
  simplePath,
  style,
  zoomCursor,
}: {
  autofocus: Autofocus
  debugIndex?: number
  depth: number
  dropBefore?: boolean
  env?: LazyEnv
  indexDescendant: number
  isMultiColumnTable?: boolean
  leaf?: boolean
  path: Path
  prevChildId?: ThoughtId
  showContexts?: boolean
  simplePath: SimplePath
  style?: React.CSSProperties
  zoomCursor?: boolean
}) => {
  const state = store.getState()
  const ref = useRef<HTMLDivElement>(null)
  const thought = useSelector((state: State) => getThoughtById(state, head(simplePath)), shallowEqual)
  const noOtherContexts = useSelector(
    (state: State) => isContextViewActive(state, simplePath) && getContexts(state, thought.value).length <= 1,
  )
  const parentId = thought.parentId
  const grandparentId = simplePath[simplePath.length - 3]
  const isVisible = zoomCursor || autofocus === 'show' || autofocus === 'dim'
  const autofocusChanged = useChangeRef(autofocus)

  const childrenAttributeId = useSelector(
    (state: State) =>
      (thought.value !== '=children' && findAnyChild(state, parentId, child => child.value === '=children')?.id) ||
      null,
  )
  const grandchildrenAttributeId = useSelector(
    (state: State) =>
      (thought.value !== '=style' &&
        findAnyChild(state, grandparentId, child => child.value === '=grandchildren')?.id) ||
      null,
  )
  const hideBullet = useSelector((state: State) => {
    const hideBulletsChildren = attribute(state, childrenAttributeId, '=bullet') === 'None'
    if (hideBulletsChildren) return true
    const hideBulletsGrandchildren =
      thought.value !== '=bullet' && attribute(state, grandchildrenAttributeId, '=bullet') === 'None'
    if (hideBulletsGrandchildren) return true
    return false
  })

  /****************************/

  const childEnvZoomId = once(() => findFirstEnvContextWithZoom(state, { id: thought.id, env }))

  /** Returns true if the cursor is contained within the thought path, i.e. the thought is a descendant of the cursor. */
  const isEditingChildPath = isDescendantPath(state.cursor, path)

  const styleSelf = useMemo(
    () => ({
      ...(isEditingChildPath ? getStyle(state, childEnvZoomId()) : null),
      ...style,
    }),
    [isEditingChildPath, style],
  )

  // When autofocus changes, use a slow (750ms) ease-out to provide a gentle transition to non-focal thoughts.
  // If autofocus has not changed, it means that the thought is being rendered for the first time, such as the children of a thought that was just expanded. In this case, match the tree-node top animation (150ms) to ensure that the newly rendered thoughts fade in to fill the space that is being opened up from the next uncle animating down.
  // Note that ease-in is used in contrast to the tree-node's ease-out. This gives a little more time for the next uncle to animate down and clear space before the newly rendered thought fades in. Otherwise they overlap too much during the transition.
  const opacity = autofocus === 'show' ? '1' : autofocus === 'dim' ? '0.5' : '0'
  const opacityTransition = autofocusChanged ? 'opacity 0.75s ease-out' : 'opacity 0.15s ease-in'
  useEffect(() => {
    if (!ref.current) return
    // start opacity at 0 and set to actual opacity in useEffect
    ref.current.style.opacity = opacity
  })

  // Short circuit if thought has already been removed.
  // This can occur in a re-render even when thought is defined in the parent component.
  if (!thought) return null

  return (
    <>
      <div
        ref={ref}
        style={{
          // Start opacity at 0 and set to actual opacity in useEffect.
          // Do not fade in empty thoughts. An instant snap in feels better here.
          // opacity creates a new stacking context, so it must only be applied to Thought, not to the outer VirtualThought which contains DropEmpty. Otherwise subsequent DropEmpty will be obscured.
          opacity: thought.value === '' ? opacity : '0',
          transition: opacityTransition,
          pointerEvents: !isVisible ? 'none' : undefined,
        }}
      >
        <Thought
          debugIndex={debugIndex}
          depth={depth + 1}
          env={env}
          hideBullet={hideBullet}
          isContextPending={thought.value === '__PENDING__'}
          leaf={leaf}
          // isHeader={isHeader}
          isHeader={false}
          isMultiColumnTable={isMultiColumnTable}
          isVisible={isVisible}
          path={path}
          prevChildId={prevChildId}
          rank={thought.rank}
          showContexts={showContexts}
          simplePath={simplePath}
          style={styleSelf}
        />
      </div>

      {noOtherContexts && <NoOtherContexts simplePath={simplePath} />}
    </>
  )
}

export default VirtualThoughtMemo
