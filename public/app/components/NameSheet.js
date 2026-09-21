// The first thing a new player sees: a name and an animal. It is the only form in Parlor
// that stands between someone and a game, so it is two fields, both optional to think
// about, and the button says what happens next.
//
// The name is saved to this device (identity.js), not to an account, so it is asked once
// and then remembered. The same sheet is reused later from the room menu to change either.

import { html, useRef, useState } from '../h.js';
import { AVATARS, me, setMe } from '../identity.js';
import { Sheet } from './Sheet.js';

/**
 * @param {{
 *   title?: string,
 *   cta?: string,
 *   onDone: (who: { id: string, name: string, avatar: string }) => void,
 *   onClose: () => void,
 * }} props
 */
export function NameSheet({ title = 'Your name', cta = 'Continue', onDone, onClose }) {
  const current = useRef(me());
  const [name, setName] = useState(current.current.name);
  const [avatar, setAvatar] = useState(current.current.avatar);
  const [problem, setProblem] = useState('');

  function submit(event) {
    if (event) event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem('Type a name so people know who you are.');
      return;
    }
    onDone(setMe({ name: trimmed, avatar }));
  }

  return html`
    <${Sheet} title=${title} onClose=${onClose}>
      <form class="stack-loose stack" onSubmit=${submit}>
        <div class=${problem ? 'field is-invalid' : 'field'}>
          <label class="field-label sr-only" for="name-input">Your name</label>
          <input class="input" id="name-input" value=${name} maxLength="24" autocomplete="nickname"
                 enterkeyhint="done" placeholder="Sam"
                 onInput=${(e) => { setName(e.currentTarget.value); if (problem) setProblem(''); }} />
          ${problem
            ? html`<div class="field-error">${problem}</div>`
            : html`<div class="field-help">Friends see it at the table.</div>`}
        </div>
        <div class="field">
          <span class="field-label" id="avatar-label">Pick an animal</span>
          <div class="picker" role="group" aria-labelledby="avatar-label">
            ${AVATARS.map((emoji) => html`
              <button type="button" key=${emoji} aria-pressed=${emoji === avatar} aria-label=${emoji}
                      onClick=${() => setAvatar(emoji)}>${emoji}</button>`)}
          </div>
        </div>
        <button class="btn btn-primary btn-block btn-tall" type="submit">${cta}</button>
      </form>
    <//>`;
}
