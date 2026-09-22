// Shared duel artwork for guest introductions, solo speed rounds and live duels.
import { html } from "../app/h.js";

/** Map either left/right corner gesture to the corresponding answer door. @param {number} corner */
export const doorSide = corner => corner % 2;

/** The named body that receives a portrait. @param {{label:string}} choice @param {number} index */
export function doorMarkup(choice, index) {
  return html`<span class="plate ${choice.label.length > 30 ? "long longest" : choice.label.length > 15 ? "long" : ""}"><span class="key" aria-hidden="true">${index + 1}</span><span class="tl">Hello, I'm</span><span class="pname">${choice.label}</span></span><span class="slot"></span><span class="bod"></span>`;
}

/** The portrait held above the two doors. @param {{image:string}} question @param {Map<string,string>} urls */
export function doorPieceMarkup(question, urls) {
  return html`<span class="figure"><span class="slot filled"><img class="portrait" src=${urls.get(question.image)} alt="Classmate portrait" draggable=${false} /></span><span class="bod"></span></span>`;
}
