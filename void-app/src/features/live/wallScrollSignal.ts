// WHEN THE WALL LAST SCROLLED, AS A TIMESTAMP THE UI THREAD CAN READ.
//
// The globe's pause used to travel JS state -> effect -> runningSV, so under a
// saturated JS thread it engaged frames late - the gesture had already paid for
// a full GL frame or two before the latch landed - and every scroll event cost
// a clearTimeout + setState + setTimeout to keep it alive. This is the same
// signal with no JS in the loop: the wall writes Date.now() on every scroll
// event (a shared-value write, no commit), and the render worklet holds its
// frame while the timestamp is fresh. Nothing ever writes a 'false', so the
// stuck-latch failure the old 900ms expiry existed to prevent cannot happen:
// the hold expires on the UI thread, by itself, when the writes stop.
import { makeMutable } from 'react-native-reanimated';

export const wallScrollAtSV = makeMutable(0);
