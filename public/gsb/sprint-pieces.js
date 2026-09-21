// Shared arcade portrait and answer artwork for signed-in Speed and the guest introduction.
import { html } from "../app/h.js";
import { visibleQuestionPrompt } from "./components.js";

/** The piece the player holds: a whole person on a face question, a headless body wearing the name on a name question. */
export function pieceMarkup(question, photoUrls, silhouette) {
  if (question.direction === "face") return html`<span class="figure">
    <span class="slot filled">${!silhouette && html`<img class="portrait" src=${photoUrls.get(question.image)} alt="Classmate portrait" draggable=${false} />`}</span>
    <span class="bod"></span>
  </span>`;
  return html`<span class="figure">
    <span class="slot"></span><span class="bod"></span>
    ${silhouette
      ? html`<span class="tag chest"><span class="tl"></span><span class="tn"></span></span>`
      : html`<h1 class="sprint-name tag chest"><span class="tl">Hi, I'm</span><span class="tn">${visibleQuestionPrompt(question)}</span></h1>`}
  </span>`;
}

/** A corner target: a name plate on a face question, a framed portrait on a name question, each with a faint body under it. */
export function zoneMarkup(choice, i, photoUrls) {
  if (choice.image) return html`<span class="slot filled"><span class="key" aria-hidden="true">${i + 1}</span><img class="choice-photo" src=${photoUrls.get(choice.image)} alt=${`Option photo ${i + 1}`} draggable=${false} /></span><span class="bod ghost"></span>`;
  return html`<span class="plate ${choice.label.length > 22 ? "long" : ""}"><span class="key" aria-hidden="true">${i + 1}</span><span class="pname">${choice.label}</span></span><span class="bod ghost"></span>`;
}

