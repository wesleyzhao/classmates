// Small personal history panel, independent of the visual game screens and study scheduler.
import { html, useState } from '../app/h.js';
import { api } from './components.js';
/** Load private cross-mode coverage only when the account panel is expanded. */
export function LearningSummary() {
  const [data,setData] = useState(null), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const load = async () => {
    if (busy) return;
    setBusy(true);setError('');
    try { setData(await api('learning')); } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const list = (title,faces,kind) => html`<h3>${title}</h3><ul>${faces.map(f => html`<li key=${f.id}>${f.name}: ${f[kind]} ${kind==='wrong'?'missed':'right'} out of ${f.correct+f.wrong} answered</li>`)}</ul>`;
  return html`<details class="gsb-card" onToggle=${e => { if (e.currentTarget.open && !data) load(); }}>
    <summary>Your face history</summary>
    ${busy && html`<p role="status">Loading your history.</p>`}
    ${error && html`<p role="alert">${error} <button class="linkbtn" onClick=${load}>Try again</button></p>`}
    ${data && html`<p>${data.seen} of ${data.total} classmates played. ${data.unseen} still new.</p>
      <p class="small muted">Across all games. Accuracy counts your first answer to each question. Practice keeps its own review schedule.</p>
      ${data.correct+data.wrong ? html`<p>${data.correct} right out of ${data.correct+data.wrong} answered.</p>` : html`<p>Your answers will appear here after you play.</p>`}
      ${data.mostMissed.length>0 && list('Most missed',data.mostMissed,'wrong')}
      ${data.mostCorrect.length>0 && list('Most right',data.mostCorrect,'correct')}`}
  </details>`;
}
