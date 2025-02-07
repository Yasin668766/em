import { nanoid } from 'nanoid'
import 'react-native-get-random-values'
import ThoughtId from '../@types/ThoughtId'
import globals from '../globals'

// autoincrement for debugging
let n = 0

/** Creates a universally unique identifier. */
// Should be safe to use a nanoid of length 13 rather than the default 21 since thoughts only need to be unique per thoughtspace.
// 100 IDs/hr @ length 13 for ~89 thousand years -> 1% probability of collision
// If thoughts are stored globally, we should increase this length.
// See: https://zelark.github.io/nano-id-cc/
const createId: () => ThoughtId = globals.debugIds ? () => (n++).toString() as ThoughtId : () => nanoid(13) as ThoughtId

export default createId
