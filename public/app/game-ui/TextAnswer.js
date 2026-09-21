// Typing an answer. The box holds a draft until it is sent, then shows what was sent and
// gets out of the way; there is no second chance, so the button is the commitment.
//
// The near miss line only appears after the answer is up. Telling someone they were close
// while the card is still running would tell them they were wrong, which is the kit's
// secret to keep.

import { html, useState } from '../h.js';

/**
 * @param {{
 *   submitted?: string | null,   // what this player already sent, if anything
 *   revealed?: boolean,
 *   correct?: boolean,
 *   close?: boolean,             // wrong, but nearly right (match.isClose)
 *   disabled?: boolean,
 *   onAnswer?: (text: string) => void,
 * }} props
 */
export function TextAnswer({ submitted = null, revealed = false, correct = false, close = false, disabled = false, onAnswer }) {
  const [draft, setDraft] = useState('');
  const locked = disabled || revealed || submitted !== null;
  const text = draft.trim();

  if (submitted !== null) {
    return html`
      <div class="stack-tight">
        <div class="input" aria-label="Your answer">${submitted}</div>
        ${revealed && !correct && close ? html`<p class="small muted center">Close, but not quite.</p>` : null}
      </div>`;
  }

  return html`
    <form
      class="row"
      onSubmit=${(event) => {
        event.preventDefault();
        if (!locked && text && onAnswer) onAnswer(text);
      }}
    >
      <input
        class="input"
        type="text"
        name="answer"
        value=${draft}
        placeholder="Type your answer"
        aria-label="Your answer"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck=${false}
        enterkeyhint="send"
        maxLength=${80}
        disabled=${locked}
        onInput=${(event) => setDraft(event.currentTarget.value)}
      />
      <button class="btn btn-primary" type="submit" disabled=${locked || !text}>Answer</button>
    </form>`;
}
