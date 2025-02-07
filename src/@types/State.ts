import DropThoughtZone from '../@types/DropThoughtZone'
import Alert from './Alert'
import Context from './Context'
import DragShortcutZone from './DragShortcutZone'
import Index from './IndexType'
import Modal from './Modal'
import Patch from './Patch'
import Path from './Path'
import PushBatch from './PushBatch'
import RecentlyEditedTree from './RecentlyEditedTree'
import Shortcut from './Shortcut'
import ShortcutId from './ShortcutId'
import SimplePath from './SimplePath'
import ThoughtIndices from './ThoughtIndices'
import Timestamp from './Timestamp'

interface State {
  absoluteContextTime?: Timestamp
  alert?: Alert | null
  archived?: boolean
  authenticated: boolean
  autologin: boolean
  // key: hashPath(path)
  contextViews: Index<boolean>
  cursor: Path | null
  // set to true when clearThought is activated
  // temporarily renders the cursor thought as an empty string for quickly changing the entire value
  // see: /reducers/cursorCleared
  cursorCleared: boolean
  cursorBeforeQuickAdd: Path | null
  cursorBeforeSearch: Path | null
  cursorHistory: Path[]
  cursorInitialized: boolean
  // the offset of the caret within the cursor, relative to the start of the thought
  // currently only 0 and n are used, where n is the length of the thought
  // null means that the caret is not forcefully set on re-render, allowing the device to set it, e.g. on click
  cursorOffset: number | null
  // Hides the toolbar and nav bar to allow for distraction-free typing on desktop.
  distractionFreeTyping?: boolean
  // SimplePath of thought with drag hold activated
  draggedSimplePath?: SimplePath
  draggingThought?: SimplePath
  // Dragging a shortcut or toolbar button in the customizeToolbar modal
  dragShortcut?: ShortcutId | null
  // type of toolbar-sbutton drop target being hovered over
  dragShortcutZone?: DragShortcutZone
  // set to true while the user is long pressing a thought in preparation for a drag
  dragHold?: boolean
  // set to true while the user is dragging a thought
  // may be set to false to abort the drag even while react-dnd is still dragging (e.g. by shaking)
  dragInProgress: boolean
  // forces content editable to update inner html if html has not changed
  // TODO: Do we really need to re-render all ContentEditables?
  //   Is there a state value we can subscribe to re-render only thoughts that are needed?
  editableNonce: number
  editing: boolean | null
  // show the latest activated shortcuts at the bottom of the screen for webcasts.
  enableLatestShortcutsDiagram: boolean
  error?: string | null
  expanded: Index<Path>
  expandHoverDownPaths: Index<Path>
  expandHoverUpPath?: Path | null
  expandedContextThought?: Path
  fontSize: number
  // Thought currently being hovered over.
  // Used to determine the parent of state.hoveringPath to be highlighted (via isChildHovering in the Thought components), expandHoverDown/Top, and the visibility of drop-hover elements.
  hoveringPath?: Path
  // type of thought drop target being hovered over
  hoverZone?: DropThoughtZone
  invalidState: boolean
  isLoading: boolean
  // History of edit points that can be navigated with the jump command.
  // Cannot use undoHistory because it omits the cursor from some edits.
  // i.e. It causes the 'jump after new subthought' to fail.
  jumpHistory: (Path | null)[]
  // The current index of the jump history that is being navigated
  // Increments on each activation of Jump Back, and determines where the cursor is moved on Jump Forward
  jumpIndex: number
  lastUpdated?: string
  latestShortcuts: Shortcut[]
  modals: Index<{ complete?: boolean }>
  // noteFocus is true if the caret is on the note
  noteFocus: boolean
  // NOTE: Clearing the pushQueue is delayed until the *next* action to avoid an extra dispatch.
  // It will be cleared by the time any other reducer runs, but do not assume it is up to date if you access it directly from store.getState().
  // See: /redux-enhancers/clearPushQueue
  pushQueue: PushBatch[]
  recentlyEdited: RecentlyEditedTree
  redoPatches: Patch[]
  remoteSearch: boolean
  resourceCache: Index<string>
  rootContext: Context
  schemaVersion: number
  search: string | null
  searchContexts: Index<Context> | null
  searchLimit?: number
  showColorPicker?: boolean
  showHiddenThoughts: boolean
  showModal?: Modal | null
  showSidebar: boolean
  showSplitView: boolean
  // react-split-pane Size
  // % or px
  splitPosition: number
  /* status:
      'disconnected'   Logged out or yet to connect, but not in explicit offline mode.
      'connecting'     Connecting.
      'loading'        Connected, authenticated, and waiting for first user data payload.
      'loaded'         User data payload received (may or may not be offline).
      'offline'        Disconnected and working in offline mode.
    */
  status: string
  // Thought values that are needed on startup before thoughts have loaded (e.g. theme, tutorial, etc) are cached to local storage.
  // storageCache is populated initially with the values in local storage and updated as the state changes.
  // See: /redux-enhancers/storageCache.ts
  storageCache?: {
    theme?: 'Dark' | 'Light'
    tutorialComplete?: boolean
    tutorialStep?: number
    userToolbar?: ShortcutId[]
  }
  thoughts: ThoughtIndices
  // shortcut of a toolbar button that is being long pressed in the customize modal
  toolbarLongPress?: Shortcut
  transientFocus?: boolean
  tutorialStep?: number
  undoPatches: Patch[]
}

export default State
