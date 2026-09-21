// Parlor's generic recognition screen uses the pure kit's view, with no Classmates auth or styling dependency.
import { html,useRef,useState } from '../../app/h.js';
import { useNow } from '../../app/components/Timer.js';
import { PromptCard } from '../../app/game-ui/PromptCard.js';
import { playerName } from '../../app/lib.js';

/** Render a public image deck in ordinary Parlor rooms. Private rosters belong in the Classmates profile.
 * @param {{view:any,me:string|null,players:any[],send:(type:string,payload:any)=>any,now:number}} props
 */
export function Play({view,me,players,send,now}) {
  const ticking=useNow(view.phase!=='over'),at=Math.max(now||0,ticking),lock=useRef(false);
  const [pending,setPending]=useState(false),[error,setError]=useState(/** @type {{questionId:string,text:string}|null} */(null)),q=view.question,mine=view.mine;
  const disabled=pending||!mine||mine.finishedAt!==null||view.phase!=='question'||at<view.roundAt||at<mine.blockedUntil||view.mode==='together'&&mine.choice!==null;
  const pick=async choice=>{
    if(disabled||lock.current||mine.wrong.includes(choice))return;
    lock.current=true;setPending(true);setError(null);
    try {await send('answer',{questionId:q.id,choice});}
    catch {setError({questionId:q.id,text:'Your answer did not save. Try again.'});}
    finally {lock.current=false;setPending(false);}
  };
  return html`<section class="stack" aria-label="Recognition game">
    <div class="topbar"><span class="small num">Card ${view.progress.n} of ${view.progress.total}</span>
      <span class="small ink-2">${view.mode==='race'?'Correct answers move you forward.':'Answer together.'}</span></div>
    ${error?.questionId===q?.id && error && html`<p role="alert">${error.text}</p>`}
    ${!q ? html`<p role="status">${view.phase==='over'?'Round complete.':'Waiting for the round.'}</p>` : html`
      ${q.image ? html`<${PromptCard} card=${{image:q.image,prompt:q.prompt}} size="sm" />`
        : html`<h2 class="center">${q.prompt.replace(/^Which face belongs to (.+)\?$/,'$1')}</h2>`}
      ${q.image && html`<span class="sr-only">${q.prompt}</span>`}
      <div class="choices" style=${q.choices.some(c=>c.image)?'display:grid;grid-template-columns:repeat(2,minmax(0,1fr))':undefined} role="group" aria-label="Answers">${q.choices.map((choice,i)=>html`
        <button type="button" key=${choice.id} class=${`choice${view.reveal?.choice===choice.id?' is-right':mine?.wrong.includes(choice.id)?' is-wrong':''}`}
          style=${choice.image?'display:flex;justify-content:center;padding:8px;border-radius:var(--radius-m)':undefined}
          disabled=${disabled||mine?.wrong.includes(choice.id)} aria-pressed=${mine?.choice===choice.id}
          onClick=${()=>pick(choice.id)}>
          ${choice.image ? html`<img src=${choice.image} alt=${`Option photo ${i+1}`} width="160" height="120" style="max-width:100%;height:18svh;object-fit:contain" />` : choice.label}
        </button>`)}</div>
      ${view.reveal && html`<p class="center" role="status">${view.reveal.name}</p>`}`}
    <ul class="list" aria-label="Standings">${view.standings.map(row=>html`<li class="list-row" key=${row.playerId}>
      <span class="grow">${playerName(players.find(p=>p.id===row.playerId),me)}</span><span class="num">${row.score}</span></li>`)}</ul>
  </section>`;
}
