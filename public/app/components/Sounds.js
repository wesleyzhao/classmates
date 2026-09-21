// The hooks that turn what happened into a noise. Two sources: the room's public log (someone
// answered, someone joined, someone won) and the view's `waitingOn` (it is now your move).
// Both decide from the snapshot rather than from a local count, so a phone that missed a poll
// hears what it missed once and not twice, and a reload does not replay an hour of clicks.

import { useEffect, useRef } from '../h.js';
import { lastLogN, logSince } from '../lib.js';
import { chime } from '../sound.js';

/**
 * Play a noise for log events this device has not heard yet.
 * @param {import('../../../types/parlor.js').LogEntry[] | undefined} log
 * @param {Record<string, () => void>} table  event type to the noise for it
 */
export function useLogSounds(log, table) {
  const seen = useRef(/** @type {number | null} */ (null));
  const highest = lastLogN(log);
  useEffect(() => {
    // The first log we see is history, not news: note where it got to and play nothing.
    if (seen.current === null) { seen.current = highest; return; }
    const fresh = logSince(log, seen.current);
    seen.current = highest;
    for (const entry of fresh) {
      const play = table[entry.type];
      if (play) play();
    }
  }, [highest]);
}

/**
 * A chime the moment the game starts waiting on this player: a new card in a quiz, the turn
 * passing to them on a board or at a card table. Nothing on the first view, so opening a
 * room does not chime, and nothing while they stay on the hook.
 * @param {import('../../../types/parlor.js').KitView | null} view
 * @param {string | null} meId
 */
export function useTurnChime(view, meId) {
  const wasOnMe = useRef(/** @type {boolean | null} */ (null));
  const onMe = !!meId && Array.isArray(view && view.waitingOn) && view.waitingOn.includes(meId);
  useEffect(() => {
    if (wasOnMe.current === null) { wasOnMe.current = onMe; return; }
    if (onMe && !wasOnMe.current) chime();
    wasOnMe.current = onMe;
  }, [onMe]);
}
