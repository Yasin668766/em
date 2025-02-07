import Shortcut from '../@types/Shortcut'
import showModal from '../action-creators/showModal'
import ShareIcon from '../components/icons/ShareIcon'
import { HOME_TOKEN } from '../constants'
import { getAllChildren } from '../selectors/getChildren'

const shortcut: Shortcut = {
  id: 'exportContext',
  label: 'Export Context',
  description: 'Download or copy the current context as plaintext or html',
  svg: ShareIcon,
  canExecute: getState => {
    const state = getState()
    if (state.cursor) return true
    return getAllChildren(state, HOME_TOKEN).length > 0
  },
  exec: dispatch => dispatch(showModal({ id: 'export' })),
}

export default shortcut
