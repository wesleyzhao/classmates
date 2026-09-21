// The tiles a player taps. One column in the editorial theme, two in the playful one, all
// from `.choices` in base.css; long answers take a single column in both, because a name
// that wraps to three lines in a tile is unreadable.
//
// It paints three states and computes none of them: what I picked, what was right, and what
// is no longer interesting. The kit decides which is which.

import { html } from '../h.js';

/** Longer than this and two to a row stops working on a phone. */
const LONG = 14;

/**
 * @param {{
 *   choices: string[],
 *   picked?: number | null,        // the index this player tapped
 *   correct?: number | null,       // the right index, once the answer is up
 *   revealed?: boolean,
 *   disabled?: boolean,
 *   onPick?: (index: number) => void,
 * }} props
 */
export function ChoiceGrid({ choices, picked = null, correct = null, revealed = false, disabled = false, onPick }) {
  if (!choices || !choices.length) return null;
  const long = choices.some((choice) => String(choice).length > LONG);
  const locked = disabled || revealed || picked !== null;
  return html`
    <div class=${long ? 'choices is-long' : 'choices'} role="group">
      ${choices.map((choice, index) => html`
        <button
          key=${index}
          type="button"
          class=${classesFor(index, { picked, correct, revealed })}
          aria-disabled=${locked}
          aria-pressed=${picked === index}
          onClick=${() => !locked && onPick && onPick(index)}
        >${choice}</button>`)}
    </div>`;
}

/** Which of the four looks a tile is wearing right now. */
function classesFor(index, { picked, correct, revealed }) {
  const classes = ['choice'];
  if (revealed && correct !== null && correct >= 0) {
    if (index === correct) classes.push('is-right');
    else if (index === picked) classes.push('is-wrong');
    else classes.push('is-dim');
  } else if (index === picked) {
    // The tiles nobody picked stay as they are while the card runs: dimming them now would
    // read as an answer. They dim at the reveal, where the point is what was right.
    classes.push('is-picked');
  }
  return classes.join(' ');
}
