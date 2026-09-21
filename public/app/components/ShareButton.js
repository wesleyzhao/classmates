// "Share link". On a phone this opens the system share sheet, which is how a code actually
// reaches a group chat; everywhere else it copies the link and says so. Both paths end with
// the link on its way, which is why it is one button and not two.

import { html } from '../h.js';
import { Icon } from './Icon.js';
import { toast } from './Toast.js';
import { shareText } from '../lib.js';

/**
 * @param {{ code?: string, gameTitle?: string, label?: string, class?: string,
 *   link?: { title: string, text: string, url: string } }} props
 * `link` shares something that is not a room: the creator hands it a game's own address, which
 * has no code in it. Without it this shares the room `code` names, which is the usual case.
 */
export function ShareButton({ code, gameTitle, label = 'Share link', class: className = 'btn btn-primary', link }) {
  async function share() {
    const payload = link || shareText({ code, gameTitle });
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        // A cancelled share is not a failure, so fall through to copying only on a real error.
        if (err && /** @type {any} */ (err).name === 'AbortError') return;
      }
    }
    await copy(payload.url, 'Link copied');
  }

  return html`
    <button class=${className} onClick=${share}>
      <${Icon} name="share" />
      ${label}
    </button>`;
}

/**
 * The other half of sharing: the code on its own, for people who are in the room with you.
 * @param {{ code: string, label?: string, class?: string }} props
 */
export function CopyCodeButton({ code, label = 'Copy code', class: className = 'btn btn-secondary' }) {
  return html`
    <button class=${className} onClick=${() => copy(code, 'Code copied')}>${label}</button>`;
}

/**
 * Put text on the clipboard and say so. Clipboard access is refused often enough (an
 * insecure origin, an old browser, a webview) that the failure needs a sentence of its own.
 * @param {string} text
 * @param {string} said  what the toast says when it worked
 */
export async function copy(text, said) {
  try {
    await navigator.clipboard.writeText(text);
    toast(said);
  } catch {
    toast('This browser will not let Parlor copy. Select the text and copy it yourself.', { bad: true });
  }
}
