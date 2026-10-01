// ClockPin: render an animated document at a chosen document time instead of "now".
//
// Without this, a preview of an animated document is captured at whatever instant the render
// happened to finish, so the same document gives a different image every run and a reviewer
// cannot tell a fix from noise.
//
// Pinning is not a matter of overriding one function. Three things read time independently:
//
//   * `clock.snapshot()` builds every time system variable, and SystemClock.snapshot() reads
//     Date.now() directly rather than this.millis() - so overriding millis alone does nothing.
//   * three separate objects can hold a clock: the document's TimeVariables, the document, and
//     the remote context. Missing any one leaves part of the frame live.
//   * animationTime does not come from the clock at all; it is performance.now() measured from
//     document load, via TimeVariables.getElapsedSeconds().
//
// `continuousSec()` is minute*60 + second within the hour, not seconds since load, so the pin
// works by placing the clock at a fixed midnight plus `seconds`. That makes continuousSec()
// exactly equal to `seconds` for values under an hour, and wrap above it.

import { createSnapshot, type RemoteClock } from './RemoteClock';

// A fixed instant, so year/month/dayOfWeek are reproducible too and not merely today's.
const PIN_EPOCH = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();

/**
 * Pin a player's clock to `seconds` of document time. Returns true if any clock was reached;
 * false means the frame is still live and a caller reporting a pinned time would be wrong.
 */
export function pinClock(player: any, seconds: number): boolean {
    const doc = player && player.document;
    const tv = doc && doc.mTimeVariables;
    const millis = PIN_EPOCH + Math.round(seconds * 1000);

    let pinned = false;
    const clocks: (RemoteClock | undefined)[] = [
        tv && tv.getClock && tv.getClock(),
        doc && doc.getClock && doc.getClock(),
        player && player.remoteContext && player.remoteContext.getClock
            && player.remoteContext.getClock(),
    ];
    for (const c of clocks) {
        if (!c) continue;
        c.millis = () => millis;
        c.snapshot = () => createSnapshot(millis);
        pinned = true;
    }

    // Pinned separately: this one is wall-clock elapsed, not calendar time.
    if (tv) tv.getElapsedSeconds = () => seconds;

    return pinned;
}
