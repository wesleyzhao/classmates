// The game's few noises, from Parlor's sound design: a ding for a right answer, a buzz for a wrong one,
// a chime when a round ends, four notes for a perfect one, a pop when somebody joins the room.
// Sound is on unless this device turned it off (the switch is in the footer and on the speed screen).
//
// Phones need two things before a page may make a noise: a tap, and, on an iPhone with the ring switch off,
// an ordinary media element playing so the audio session counts as playback rather than a ringer sound.
// The first tap anywhere starts a silent looping clip, which lifts the ring switch's mute for the noises after it.
import { buzz, chime, ding, isSoundOn, pop, primeOnGesture as primeContext, setLevel, setSound, win } from "../app/sound.js";
export { isSoundOn, setSound };
setLevel(2.4);
const SILENCE = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";
let media = null;
function unlockMedia() {
  if (!isSoundOn()) return;
  try {
    if (!media) {
      media = document.createElement("audio");
      media.setAttribute("playsinline", ""); media.setAttribute("preload", "auto");
      media.loop = true; media.volume = 0.01; media.src = SILENCE;
    }
    if (media.paused) media.play().catch(() => {});
  } catch { /* no media element, no noise */ }
}
/** Unlock audio on the first tap or key, so later noises that arrive on their own are allowed to play. */
export function primeOnGesture() {
  primeContext();
  if (typeof addEventListener !== "function") return;
  for (const type of ["pointerdown", "touchend", "keydown"]) addEventListener(type, unlockMedia, { capture: true, passive: true });
}
export const sfx = {
  right: ding,
  wrong: buzz,
  done: chime,
  perfect: win,
  join: pop,
};
