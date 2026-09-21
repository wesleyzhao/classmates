// The whole sound design: a handful of short noises made with oscillators. No audio files,
// so nothing to download, nothing to cache, and no licence to track.
//
// Sound is on unless a player turns it off in the room menu, and the choice is remembered
// per device. Phones only let a page make noise after a tap, so the first tap anywhere
// (joining, starting, answering) quietly unlocks the audio context for the noises that come
// later on their own: a chat line, a new card, your turn.
//
// Every entry point is safe to call at any time. When there is no AudioContext (an old
// browser, a locked-down webview) the functions do nothing rather than throw, because a
// missing noise must never take a screen down with it.

import { soundOn, setSoundOn } from './identity.js';

/** @type {AudioContext | null} */
let audio = null;
/** True once we have tried and failed, so we stop trying on every tick. */
let unavailable = false;

/** @returns {boolean} whether this device wants sound */
export function isSoundOn() {
  return soundOn();
}

/**
 * Turn sound on or off and remember it. Turning it on from a tap is what unlocks audio
 * on iOS, so this is called from a real button and nowhere else.
 * @param {boolean} on
 */
export function setSound(on) {
  setSoundOn(on);
  if (on) {
    const ctx = context();
    // Safari starts the context suspended until a gesture resumes it.
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    blip({ from: 880, to: 1320, duration: 0.12, type: 'triangle', gain: 0.05 });
  }
}

/** How loud, as a multiple of the design's own levels: a game that plays on phone speakers may ask for more. */
let level = 1;
/** @param {number} times */
export function setLevel(times) { level = Math.max(0, times); }

/** Someone answered, someone tapped a card: a small dry click. */
export function tick() {
  blip({ from: 1180, to: 1180, duration: 0.035, type: 'square', gain: 0.028 });
}

/** Your own tap landed. Softer and lower than tick, so the two do not fight. */
export function tap() {
  blip({ from: 320, to: 240, duration: 0.06, type: 'sine', gain: 0.05 });
}

/** Something resolved: a card revealed, a turn passed. */
export function ding() {
  blip({ from: 880, to: 880, duration: 0.09, type: 'triangle', gain: 0.05 });
  blip({ from: 1320, to: 1320, duration: 0.14, type: 'triangle', gain: 0.04, delay: 0.07 });
}

/** Somebody said something in the chat: a soft two-note pop. */
export function pop() {
  blip({ from: 660, to: 660, duration: 0.05, type: 'sine', gain: 0.045 });
  blip({ from: 880, to: 880, duration: 0.08, type: 'sine', gain: 0.04, delay: 0.06 });
}

/** It is your turn, or a new card is up: a rising two-note chime, brighter than a ding. */
export function chime() {
  blip({ from: 784, to: 784, duration: 0.09, type: 'triangle', gain: 0.05 });
  blip({ from: 1175, to: 1175, duration: 0.16, type: 'triangle', gain: 0.045, delay: 0.09 });
}

/**
 * Unlock audio on the first tap or key, so later noises that arrive on their own are
 * allowed to play. Called once at boot; harmless anywhere else.
 */
export function primeOnGesture() {
  if (typeof addEventListener !== 'function') return;
  const unlock = () => {
    if (!soundOn()) return;
    const ctx = context();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  addEventListener('pointerdown', unlock, { capture: true, passive: true });
  addEventListener('keydown', unlock, { capture: true, passive: true });
}

/** That was not it: a low, short buzz, dry enough not to sting. */
export function buzz() {
  blip({ from: 180, to: 140, duration: 0.16, type: 'square', gain: 0.035 });
}

/** A die going across the table: a few dry knocks, further apart as it slows. */
export function rattle() {
  const knocks = [0, 0.08, 0.18, 0.31, 0.47, 0.66, 0.88];
  knocks.forEach((delay, i) => {
    blip({ from: 560 - i * 30, to: 420 - i * 30, duration: 0.03, type: 'square', gain: 0.03, delay });
  });
}

/** You won. Four notes up, and then it stops. */
export function win() {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((note, i) => {
    blip({ from: note, to: note, duration: i === notes.length - 1 ? 0.4 : 0.13, type: 'triangle', gain: 0.05, delay: i * 0.11 });
  });
}

/** The context, made on first use. Null forever once we know there is none. */
function context() {
  if (audio || unavailable) return audio;
  try {
    const Ctor = globalThis.AudioContext || /** @type {any} */ (globalThis).webkitAudioContext;
    if (!Ctor) { unavailable = true; return null; }
    audio = new Ctor();
    return audio;
  } catch {
    unavailable = true;
    return null;
  }
}

/**
 * One note: an oscillator through a gain envelope, scheduled and then forgotten.
 * The envelope matters more than the waveform; an abrupt stop clicks.
 * @param {{ from: number, to: number, duration: number, type: OscillatorType, gain: number, delay?: number }} note
 */
function blip(note) {
  if (!soundOn()) return;
  const ctx = context();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const at = ctx.currentTime + (note.delay || 0);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.from, at);
    if (note.to !== note.from) osc.frequency.exponentialRampToValueAtTime(note.to, at + note.duration);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(Math.min(0.5, note.gain * level), at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + note.duration + 0.02);
    osc.onended = () => { try { env.disconnect(); } catch { /* already gone */ } };
  } catch {
    // A browser that refuses to make a noise is not an error worth showing anyone.
  }
}
