import moize from 'moize'
import { FC } from 'react'
import {
  DragSource,
  DragSourceConnector,
  DragSourceMonitor,
  DropTarget,
  DropTargetConnector,
  DropTargetMonitor,
} from 'react-dnd'
import DragThoughtItem from '../@types/DragThoughtItem'
import DragThoughtZone from '../@types/DragThoughtZone'
import Path from '../@types/Path'
import alert from '../action-creators/alert'
import createThought from '../action-creators/createThought'
import dragHold from '../action-creators/dragHold'
import dragInProgress from '../action-creators/dragInProgress'
import error from '../action-creators/error'
import moveThought from '../action-creators/moveThought'
import { isTouch } from '../browser'
import { AlertType, NOOP } from '../constants'
import * as selection from '../device/selection'
import globals from '../globals'
import findDescendant from '../selectors/findDescendant'
import getNextRank from '../selectors/getNextRank'
import getRankBefore from '../selectors/getRankBefore'
import getThoughtById from '../selectors/getThoughtById'
import isBefore from '../selectors/isBefore'
import isContextViewActive from '../selectors/isContextViewActive'
import pathToThought from '../selectors/pathToThought'
import rootedParentOf from '../selectors/rootedParentOf'
import store from '../stores/app'
import appendToPath from '../util/appendToPath'
import ellipsize from '../util/ellipsize'
import equalPath from '../util/equalPath'
import head from '../util/head'
import isDescendantPath from '../util/isDescendantPath'
import isDocumentEditable from '../util/isDocumentEditable'
import isEM from '../util/isEM'
import isRoot from '../util/isRoot'
import parentOf from '../util/parentOf'
import unroot from '../util/unroot'
import { ConnectedThoughtContainerProps, ThoughtContainerProps } from './Thought'

export type ConnectedDraggableThoughtContainerProps = ConnectedThoughtContainerProps &
  ReturnType<typeof dragCollect> &
  ReturnType<typeof dropCollect>

/** Returns true if the thought can be dragged. */
const canDrag = (props: ConnectedThoughtContainerProps) => {
  const state = store.getState()
  const thoughtId = head(props.simplePath)
  const pathParentId = head(parentOf(props.simplePath))
  const isDraggable = props.isVisible || props.isCursorParent

  return (
    isDocumentEditable() &&
    !!isDraggable &&
    (!isTouch || globals.touched) &&
    !findDescendant(state, thoughtId, '=immovable') &&
    !findDescendant(state, thoughtId, '=readonly') &&
    !findDescendant(state, pathParentId, '=immovable') &&
    !findDescendant(state, pathParentId, '=readonly')
  )
}

/** Handles drag start. */
const beginDrag = ({ path, simplePath }: ConnectedThoughtContainerProps): DragThoughtItem => {
  const offset = selection.offset()
  store.dispatch(
    dragInProgress({
      value: true,
      draggingThought: simplePath,
      sourceZone: DragThoughtZone.Thoughts,
      ...(offset != null ? { offset } : null),
    }),
  )
  return { path, simplePath, zone: DragThoughtZone.Thoughts }
}

/** Handles drag end. */
const endDrag = () => {
  // Wait till the next tick before ending dragInProgress.
  // This allows onTap to be aborted in Editable to prevent the cursor from moving at the end of a drag.
  // If this delay causes a regression, then we will need to find a different way to prevent the cursor from moving at the end of a drag.
  setTimeout(() => {
    store.dispatch([
      dragInProgress({ value: false }),
      dragHold({ value: false }),
      (dispatch, getState) => {
        if (getState().alert?.alertType === AlertType.DragAndDropHint) {
          dispatch(alert(null))
        }
      },
    ])
  })
}

/** Returns true if the ThoughtContainer can be dropped at the given DropTarget. */
const canDrop = (props: ThoughtContainerProps, monitor: DropTargetMonitor) => {
  const state = store.getState()

  // dragInProgress can be set to false to abort the drag (e.g. by shaking)
  if (!state.dragInProgress) return false

  const { path: thoughtsFrom }: DragThoughtItem = monitor.getItem()
  const thoughtsTo = props.path
  const showContexts = thoughtsTo && isContextViewActive(state, parentOf(thoughtsTo))

  // Disallow dropping on context view.
  // This must be matched in isChildHovering to correctly highlight the hovering parent.
  return !showContexts && canDropPath(thoughtsFrom, thoughtsTo)
}

/** Memoized function that returns true if the thought can be dropped at the destination path. This does not need to account for hidden thoughts since they have pointer-events:none. This function will be called in a continuous loop by react-dnd so it needs to be fast. */
const canDropPath = moize((from: Path, to: Path) => !isDescendantPath(to, from, { exclusive: true }), {
  // only needs to be big enough to cache the calls within a single drag
  // i.e. a reasonable number of destation thoughts that will be hovered over during a single drag
  maxSize: 50,
  profileName: 'canDropPath',
})

/** Handles dropping a thought on a DropTarget. */
const drop = (props: ThoughtContainerProps, monitor: DropTargetMonitor) => {
  // no bubbling
  if (monitor.didDrop() || !monitor.isOver({ shallow: true })) return

  const state = store.getState()

  const { path: thoughtsFrom } = monitor.getItem()

  if (!thoughtsFrom) {
    console.warn('item.path not defined')
    return
  } else if (!props.path) {
    console.warn('props.path not defined')
    return
  }

  const thoughtsTo = props.simplePath
  const toThought = pathToThought(state, thoughtsTo)
  const fromThought = pathToThought(state, thoughtsFrom)
  const isRootOrEM = isRoot(thoughtsFrom) || isEM(thoughtsFrom)
  const sameParent = equalPath(parentOf(thoughtsFrom), parentOf(thoughtsTo))

  // cannot move root or em context
  if (isRootOrEM && !sameParent) {
    store.dispatch(
      error({ value: `Cannot move the ${isRoot(thoughtsFrom) ? 'home' : 'em'} context to another context.` }),
    )
    return
  }

  // drop on itself or after itself is a noop
  if (equalPath(thoughtsFrom, thoughtsTo) || isBefore(state, thoughtsFrom, thoughtsTo)) return

  const parent = unroot(rootedParentOf(state, thoughtsTo))
  const newPath = appendToPath(parent, head(thoughtsFrom))

  const newRank = getRankBefore(state, thoughtsTo)
  store.dispatch(
    props.showContexts
      ? createThought({
          value: toThought.value,
          path: thoughtsFrom,
          rank: getNextRank(state, thoughtsFrom),
        })
      : moveThought({
          oldPath: thoughtsFrom,
          newPath,
          newRank,
        }),
  )

  // alert user of move to another context
  if (!sameParent) {
    // wait until after MultiGesture has cleared the error so this alert does not get cleared
    setTimeout(() => {
      store.dispatch((dispatch, getState) => {
        const state = getState()
        const parentThought = getThoughtById(state, head(parentOf(thoughtsTo)))
        if (!parentThought) return
        const alertFrom = '"' + ellipsize(fromThought.value) + '"'
        const alertTo = isRoot([parentThought.id]) ? 'home' : '"' + ellipsize(parentThought.value) + '"'
        dispatch(
          alert(`${alertFrom} moved to ${alertTo} context.`, { alertType: AlertType.ThoughtMoved, clearDelay: 5000 }),
        )
      })
    }, 100)
  }
}

/** Collects props from the DragSource. */
const dragCollect = (connect: DragSourceConnector, monitor: DragSourceMonitor) => ({
  dragSource: connect.dragSource(),
  dragPreview: NOOP,
  isDragging: monitor.isDragging(),
})

/** Collects props from the DropTarget. */
const dropCollect = (connect: DropTargetConnector, monitor: DropTargetMonitor) => ({
  dropTarget: connect.dropTarget(),
  isHovering: monitor.isOver({ shallow: true }) && monitor.canDrop(),
  // is being hovered over current thought irrespective of whether the given item is droppable
  isBeingHoveredOver: monitor.isOver({ shallow: true }),
  isDeepHovering: monitor.isOver(),
})

/** A draggable and droppable Thought component. */
const DragAndDropThought = (thoughtContainer: FC<ConnectedDraggableThoughtContainerProps>) =>
  DragSource(
    'thought',
    { canDrag, beginDrag, endDrag },
    dragCollect,
  )(DropTarget('thought', { canDrop, drop }, dropCollect)(thoughtContainer))

export default DragAndDropThought
