import classNames from 'classnames'
import React, { useCallback, useMemo } from 'react'
import { connect, shallowEqual, useDispatch, useSelector } from 'react-redux'
import DragThoughtZone from '../@types/DragThoughtZone'
import DropThoughtZone from '../@types/DropThoughtZone'
import LazyEnv from '../@types/LazyEnv'
import Path from '../@types/Path'
import SimplePath from '../@types/SimplePath'
import State from '../@types/State'
import Thought from '../@types/Thought'
import ThoughtId from '../@types/ThoughtId'
import distractionFreeTyping from '../action-creators/distractionFreeTyping'
import expandContextThought from '../action-creators/expandContextThought'
import { isTouch } from '../browser'
import { AlertType, MAX_DISTANCE_FROM_CURSOR, REGEXP_TAGS } from '../constants'
import globals from '../globals'
import useDragHold from '../hooks/useDragHold'
import useHideBullet from '../hooks/useHideBullet'
import useHoveringPath from '../hooks/useHoveringPath'
import useThoughtStyle from '../hooks/useThoughtStyle'
import useThoughtStyleContainer from '../hooks/useThoughtStyleContainer'
import attribute from '../selectors/attribute'
import childIdsToThoughts from '../selectors/childIdsToThoughts'
import findDescendant from '../selectors/findDescendant'
import { getAllChildrenAsThoughts, getChildrenRanked, hasChildren } from '../selectors/getChildren'
import getStyle from '../selectors/getStyle'
import getThoughtById from '../selectors/getThoughtById'
import isContextViewActive from '../selectors/isContextViewActive'
import rootedParentOf from '../selectors/rootedParentOf'
import themeColors from '../selectors/themeColors'
import equalPath from '../util/equalPath'
import equalThoughtRanked from '../util/equalThoughtRanked'
import fastClick from '../util/fastClick'
import hashPath from '../util/hashPath'
import head from '../util/head'
import isAttribute from '../util/isAttribute'
import isDescendantPath from '../util/isDescendantPath'
import isDivider from '../util/isDivider'
import isRoot from '../util/isRoot'
import parentOf from '../util/parentOf'
import parseJsonSafe from '../util/parseJsonSafe'
import publishMode from '../util/publishMode'
import { safeRefMerge } from '../util/safeRefMerge'
import Bullet from './Bullet'
import Byline from './Byline'
import ContextBreadcrumbs from './ContextBreadcrumbs'
import DragAndDropThought, { ConnectedDraggableThoughtContainerProps } from './DragAndDropThought'
import DropThought from './DropThought'
import Note from './Note'
import StaticThought from './StaticThought'
import ThoughtAnnotation from './ThoughtAnnotation'

/**********************************************************************
 * Redux
 **********************************************************************/

export interface ThoughtContainerProps {
  allowSingleContext?: boolean
  childrenForced?: ThoughtId[]
  contextBinding?: Path
  cursor?: Path | null
  // used by globals.simulateDrop
  debugIndex?: number
  depth?: number
  env?: LazyEnv
  expandedContextThought?: Path
  hideBullet?: boolean
  // See: ThoughtProps['isContextPending']
  isContextPending?: boolean
  isCursorGrandparent?: boolean
  isCursorParent?: boolean
  isDeepHovering?: boolean
  isDragging?: boolean
  isEditing?: boolean
  isEditingPath?: boolean
  isExpanded?: boolean
  isHeader?: boolean
  isHovering?: boolean
  isMultiColumnTable?: boolean
  isPublishChild?: boolean
  // See: ThoughtProps['isVisible']
  isVisible?: boolean
  leaf?: boolean
  path: Path
  prevChildId?: ThoughtId
  publish?: boolean
  rank: number
  showContexts?: boolean
  simplePath: SimplePath
  style?: React.CSSProperties
  styleContainer?: React.CSSProperties
  view?: string | null
}

export interface ThoughtProps {
  debugIndex?: number
  editing?: boolean | null
  // When context view is activated, some contexts may be pending
  // however since they were not loaded hierarchically there is not a pending thought in the thoughtIndex
  // getContexts will return ids that do not exist in the thoughtIndex
  // Subthoughts gets the special __PENDING__ value from getContexts and passes it through to Thought and Static Thought
  isContextPending?: boolean
  isEditing?: boolean
  isPublishChild?: boolean
  // true if the thought is not hidden by autofocus, i.e. actualDistance < 2
  // currently this does not control visibility, but merely tracks it
  isVisible?: boolean
  leaf?: boolean
  onEdit?: (args: { newValue: string; oldValue: string }) => void
  path: Path
  rank: number
  showContextBreadcrumbs?: boolean
  showContexts?: boolean
  simplePath: SimplePath
  style?: React.CSSProperties
  styleContainer?: React.CSSProperties
  view?: string | null
}

export type ConnectedThoughtContainerProps = ThoughtContainerProps & ReturnType<typeof mapStateToProps>

/** Returns true if two lists of children are equal. Deeply compares id, value, and rank. */
const equalChildren = (a: Thought[], b: Thought[]) =>
  a === b ||
  (a && b && a.length === b.length && a.every((thought, i) => equalThoughtRanked(a[i], b[i]) && a[i].id === b[i].id))

// eslint-disable-next-line jsdoc/require-jsdoc
const mapStateToProps = (state: State, props: ThoughtContainerProps) => {
  const { cursor, expanded, expandedContextThought, search, expandHoverUpPath } = state

  const { path, simplePath, depth } = props

  // check if the cursor is editing a thought directly
  const isEditing = equalPath(cursor, path)

  const distance = cursor ? Math.max(0, Math.min(MAX_DISTANCE_FROM_CURSOR, cursor.length - depth!)) : 0

  const isExpandedHoverTopPath = expandHoverUpPath && equalPath(path, expandHoverUpPath)
  const cursorParent = cursor && parentOf(cursor)
  const cursorGrandparent = cursorParent && rootedParentOf(state, cursorParent)

  // Note: If the thought is the active expand hover top path then it should be treated as a cursor parent. It is because the current implementation allows tree to unfold visually starting from cursor parent.
  const isCursorParent =
    isExpandedHoverTopPath ||
    (!!cursor &&
      (distance === 2
        ? // grandparent
          equalPath(cursorGrandparent, path) && !hasChildren(state, head(cursor))
        : // parent
          equalPath(cursorParent, path)))

  const contextBinding = parseJsonSafe(attribute(state, head(simplePath), '=bindContext') ?? '') as
    | SimplePath
    | undefined

  // Note: An active expand hover top thought cannot be a cusor's grandparent as it is already treated as cursor's parent.
  const isCursorGrandparent = !isExpandedHoverTopPath && !!cursor && equalPath(cursorGrandparent, path)

  const isExpanded = !!expanded[hashPath(path)]

  return {
    contextBinding,
    expandedContextThought,
    isCursorGrandparent,
    isCursorParent,
    isEditing,
    isExpanded,
    isPublishChild: !search && publishMode() && simplePath.length === 2,
    parentView: attribute(state, head(parentOf(simplePath)), '=view'),
    publish: !search && publishMode(),
    view: attribute(state, head(simplePath), '=view'),
  }
}

/**********************************************************************
 * Components
 **********************************************************************/

/** A thought container with bullet, thought annotation, thought, and subthoughts.
 *
  @param allowSingleContext  Pass through to Subthoughts since the SearchSubthoughts component does not have direct access to the Subthoughts of the Subthoughts of the search. Default: false.
 */
const ThoughtContainer = ({
  allowSingleContext,
  childrenForced,
  contextBinding,
  cursor,
  debugIndex,
  depth = 0,
  dragPreview,
  dragSource,
  dropTarget,
  env,
  expandedContextThought,
  hideBullet: hideBulletProp,
  isBeingHoveredOver,
  isCursorGrandparent,
  isCursorParent,
  isDeepHovering,
  isDragging,
  isEditing,
  isExpanded,
  isHeader,
  isHovering,
  isMultiColumnTable,
  isContextPending,
  isPublishChild,
  isVisible,
  leaf,
  parentView,
  path,
  prevChildId,
  publish,
  rank,
  showContexts,
  simplePath,
  style: styleProp,
  styleContainer: styleContainerProp,
  view,
}: ConnectedDraggableThoughtContainerProps) => {
  const dispatch = useDispatch()
  const thoughtId = head(simplePath)
  const children = useSelector(
    (state: State) =>
      childrenForced ? childIdsToThoughts(state, childrenForced) : getChildrenRanked(state, head(simplePath)),
    // only compare id, value, and rank for re-renders
    equalChildren,
  )
  useHoveringPath(path, isBeingHoveredOver, DropThoughtZone.ThoughtDrop)

  const hideBullet = useHideBullet({ children, env, hideBulletProp, isEditing, simplePath, thoughtId })
  const style = useThoughtStyle({ children, env, styleProp, thoughtId })
  const colors = useSelector(themeColors)
  const styleAnnotation = useSelector(
    (state: State) =>
      safeRefMerge(
        // apply normal style color to the annotation style
        style?.color ? { color: style.color } : null,
        // apply annotation style (mainly used for background color)
        getStyle(state, head(simplePath), { attributeName: '=styleAnnotation' }),
      ),
    shallowEqual,
  )
  const styleContainer = useThoughtStyleContainer({ children, env, styleContainerProp, thoughtId, path })
  const value = useSelector((state: State) => getThoughtById(state, thoughtId)?.value)

  // must use isContextViewActive to read from live state rather than showContexts which is a static propr from the Subthoughts component. showContext is not updated when the context view is toggled, since the Thought should not be re-rendered.
  const isTable = useSelector((state: State) => view === 'Table' && !isContextViewActive(state, path))

  const dragHoldResult = useDragHold({
    isDragging,
    simplePath,
    sourceZone: DragThoughtZone.Thoughts,
  })

  const homeContext = useSelector((state: State) => {
    const pathParent = rootedParentOf(state, path)
    const showContexts = isContextViewActive(state, path)
    return showContexts && isRoot(pathParent)
  })

  // true if the thought has an invalid option
  const invalidOption = useSelector((state: State) => {
    const thought = getThoughtById(state, thoughtId)
    if (!thought) return false

    const parentId = head(rootedParentOf(state, simplePath))
    const optionsId = findDescendant(state, parentId, '=options')
    const childrenOptions = getAllChildrenAsThoughts(state, optionsId)

    const options =
      !isAttribute(thought.value) && childrenOptions.length > 0
        ? childrenOptions.map(thought => thought.value.toLowerCase())
        : null
    const invalidOption = options ? !options.includes(value.toLowerCase()) : false

    return invalidOption
  })

  /** True if a dragged thought is hovering over a visible child of the current thought (ThoughtDrop or SubthoughtsDrop). This determines if the parent should be highlighted. */
  // TODO: It would be nice if we could reuse canDrop.
  const isChildHovering = useSelector(
    (state: State) =>
      !!isVisible &&
      !!state.hoveringPath &&
      // Do not highlight parent of dragging thought (i.e. when simply reordering but not moving to a new parent).
      // Reordering is a less destructive action that does not need to bring attention to the parent.
      !equalPath(rootedParentOf(state, state.draggingThought!), simplePath) &&
      !isContextViewActive(state, path) &&
      // SubthoughtsDrop
      // Can drop on SubthoughtsDrop if this thought is being hovered over.
      ((state.hoverZone === DropThoughtZone.SubthoughtsDrop && equalPath(simplePath, state.hoveringPath)) ||
        // ThoughtDrop
        // Can drop on ThoughtDrop if this thought is a parent of the hovered thought, and not a descendant of the dragging thought.
        (state.hoverZone === DropThoughtZone.ThoughtDrop &&
          equalPath(rootedParentOf(state, state.hoveringPath!), simplePath) &&
          !isDescendantPath(simplePath, state.draggingThought!))) &&
      state.alert?.alertType !== AlertType.DeleteDropHint &&
      state.alert?.alertType !== AlertType.CopyOneDropHint,
  )

  // when the thought is edited on desktop, hide the top controls and breadcrumbs for distraction-free typing
  const onEdit = useCallback(({ newValue, oldValue }: { newValue: string; oldValue: string }) => {
    // only hide when typing, not when deleting
    // strip HTML tags, otherwise Formatting shortcuts will trigger distractionFreeTyping
    if (newValue.replace(REGEXP_TAGS, '').length > oldValue.replace(REGEXP_TAGS, '').length) {
      dispatch(distractionFreeTyping(true))
    }
  }, [])

  // Highlight the parent of the current drop target to make it easier to drop in the intended place.
  // Use -webkit-text-stroke-width instead of font-weight:bold, as bold changes the width of the text and can cause the thought to become multiline during a drag. This can even create an oscillation effect as the increased Thought height triggers a different hoveringPath ad infinitum (often resulting in a Shaker cancel false positive).
  // See: https://stackoverflow.com/a/46452396/480608
  const styleHover = useMemo(
    (): React.CSSProperties => ({
      ...(isChildHovering ? { color: colors.highlight, WebkitTextStrokeWidth: '0.05em' } : null),
    }),
    [isChildHovering],
  )

  // useWhyDidYouUpdate('<Thought> ' + prettyPath(store.getState(), simplePath), {
  //   allowSingleContext,
  //   childrenForced,
  //   contextBinding,
  //   cursor,
  //   debugIndex,
  //   depth,
  //   dragPreview,
  //   dragSource,
  //   dropTarget,
  //   env,
  //   expandedContextThought,
  //   hideBulletProp,
  //   isBeingHoveredOver,
  //   isCursorGrandparent,
  //   isCursorParent,
  //   isDeepHovering,
  //   isDragging,
  //   isEditing,
  //   isExpanded,
  //   isHeader,
  //   isHovering,
  //   isMultiColumnTable,
  //   isContextPending,
  //   isPublishChild,
  //   isVisible,
  //   leaf,
  //   parentView,
  //   path,
  //   prevChildId,
  //   publish,
  //   rank,
  //   showContexts,
  //   simplePath,
  //   styleProp,
  //   styleContainerProp,
  //   view,
  //   // hooks
  //   children,
  //   hideBullet,
  //   style,
  //   styleAnnotation,
  //   styleContainer,
  //   thought,
  //   grandparent,
  //   homeContext,
  //   isTable,
  //   invalidOption,
  //   isChildHovering,
  //   placeholder,
  //   styleHover,
  //   ...dragHoldResult.props,
  // })

  // thought does not exist
  if (value == null) return null

  // prevent fading out cursor parent
  // there is a special case here for the cursor grandparent when the cursor is a leaf
  // See: Subthoughts render

  const showContextBreadcrumbs =
    showContexts && (!globals.ellipsizeContextThoughts || equalPath(path, expandedContextThought as Path | null))

  return dropTarget(
    dragSource(
      <div
        {...dragHoldResult.props}
        aria-label='thought-container'
        style={{
          // so that .thought can be sized at 100% and .thought .bullet-cursor-overlay bullet can be positioned correctly.
          position: 'relative',
          // match Editable padding
          marginTop: '0.501em',
          transition: 'transform 0.75s ease-out, opacity 0.75s ease-out',
          ...style,
          ...styleContainer,
          marginLeft: style?.marginLeft ? `calc(${style.marginLeft} - 100px)` : -100,
          paddingLeft: style?.paddingLeft ? `calc(${style.paddingLeft} + 100px)` : 100,
          ...(globals.simulateDrop
            ? {
                backgroundColor: `hsl(150, 50%, ${20 + 5 * ((depth + (debugIndex || 0)) % 2)}%)`,
              }
            : null),
        }}
        className={classNames({
          child: true,
          'child-divider': isDivider(value),
          'cursor-parent': isCursorParent,
          'cursor-grandparent': isCursorGrandparent,
          // used so that the autofocus can properly highlight the immediate parent of the cursor
          editing: isEditing,
          expanded: isExpanded,
          function: isAttribute(value), // eslint-disable-line quote-props
          'has-only-child': children.length === 1,
          'invalid-option': invalidOption,
          'is-multi-column': isMultiColumnTable,
          leaf: leaf || (isEditing && globals.suppressExpansion),
          pressed: dragHoldResult.isPressed,
          // prose view will automatically be enabled if there enough characters in at least one of the thoughts within a context
          prose: view === 'Prose',
          'show-contexts': showContexts,
          'show-contexts-no-breadcrumbs': simplePath.length === 2,
          'table-view': isTable,
        })}
        ref={el => {
          if (el) {
            dragPreview()
          }
        }}
      >
        {showContexts && simplePath.length > 1 ? (
          <ContextBreadcrumbs path={parentOf(simplePath)} homeContext={homeContext} />
        ) : showContexts && simplePath.length > 2 ? (
          <span className='ellipsis'>
            <a
              tabIndex={-1}
              {...fastClick(() => {
                dispatch(expandContextThought(path))
              })}
            >
              ...{' '}
            </a>
          </span>
        ) : null}

        <div
          className='thought-container'
          style={{
            // ensure that ThoughtAnnotation is positioned correctly
            position: 'relative',
            ...(hideBullet ? { marginLeft: -12 } : null),
          }}
        >
          {!(publish && simplePath.length === 0) && (!leaf || !isPublishChild) && !hideBullet && (
            <Bullet
              isContextPending={isContextPending}
              isDragging={isDragging}
              isEditing={isEditing}
              leaf={leaf}
              path={path}
              publish={publish}
              simplePath={simplePath}
              thoughtId={thoughtId}
            />
          )}

          <DropThought isHovering={isHovering} prevChildId={prevChildId} simplePath={simplePath} />

          <ThoughtAnnotation
            env={env}
            minContexts={allowSingleContext ? 0 : 2}
            path={path}
            showContextBreadcrumbs={showContextBreadcrumbs}
            simplePath={showContexts ? parentOf(simplePath) : simplePath}
            style={styleHover}
            styleAnnotation={styleAnnotation || undefined}
          />

          <StaticThought
            isContextPending={isContextPending}
            isEditing={isEditing}
            isPublishChild={isPublishChild}
            isVisible={isVisible}
            onEdit={!isTouch ? onEdit : undefined}
            path={path}
            rank={rank}
            showContextBreadcrumbs={showContextBreadcrumbs && value !== '__PENDING__'}
            simplePath={simplePath}
            style={styleHover}
            view={view}
          />

          <Note path={simplePath} />
        </div>

        {publish && simplePath.length === 0 && <Byline id={head(parentOf(simplePath))} />}

        {/* In a multi column view, a table's grandchildren are rendered as additional columns. Since the Subthoughts component is styled as a table-cell, we render a separate Subthoughts component for each column. We use childPath instead of path in order to skip the repeated grandchild which serves as the column name and rendered separately as a header row.
        {isMultiColumnTable ? (
          children.map((child, i) => {
            const childPath = appendToPath(path, child.id)
            const childSimplePath = appendToPath(simplePath, child.id)
            return (
              <Subthoughts
                key={child.id}
                allowSingleContext={allowSingleContext}
                env={env}
                path={isHeader ? path : childPath}
                depth={depth}
                isHeader={isHeader}
                showContexts={allowSingleContext}
                simplePath={isHeader ? simplePath : childSimplePath}
              />
            )
          })
        ) : (
          <Subthoughts
            allowSingleContext={allowSingleContext}
            childrenForced={childrenForced}
            depth={depth}
            env={env}
            path={path}
            showContexts={allowSingleContext}
            simplePath={simplePath}
          />
        )} */}
      </div>,
    ),
  )
}

ThoughtContainer.displayName = 'ThoughtContainer'

// export connected, drag and drop higher order thought component
const ThoughtComponent = connect(mapStateToProps)(DragAndDropThought(ThoughtContainer))

export default ThoughtComponent
