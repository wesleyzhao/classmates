// Account-private face coverage and accuracy. This does not change Practice's memory schedule.
import { selectTargets } from '../../public/kits/recognition/selection.js';

/** Read lifetime exposure across directions and modes, in the supplied roster order. */
export async function faceHistories(db, accountIds) {
  const rows = await db.query(`select account_id,person_id,sum(seen)::int as seen,
    extract(epoch from max(last_seen))*1000 as last_seen
    from gsb_face_totals where account_id=any($1::text[]) group by account_id,person_id`, [accountIds]);
  return accountIds.map(id => Object.fromEntries(rows.filter(r => r.account_id === id)
    .map(r => [r.person_id, { seen: Number(r.seen), lastSeen: Number(r.last_seen) }])));
}

/** Choose a single fair sequence for this roster using persisted cross-mode exposure. */
export async function freshTargets(db, accounts, cards, count, rng) {
  return selectTargets(cards, await faceHistories(db, accounts), count, rng);
}

/** Personal history with counts and denominators, restricted to currently available content. */
export async function faceSummary(db, accountId, deck) {
  const rows = await db.query(`select person_id,mode,direction,seen,correct,wrong,attempts,mistakes,
    extract(epoch from last_seen)*1000 as last_seen from gsb_face_totals where account_id=$1`, [accountId]);
  const byId = new Map(deck.cards.map(c => [c.id, { id:c.id, name:c.answer, image:c.image, seen:0, correct:0, wrong:0, attempts:0, mistakes:0, lastSeen:0 }]));
  for (const r of rows) {
    const entry = byId.get(r.person_id);
    if (!entry) continue;
    for (const key of ['seen','correct','wrong','attempts','mistakes']) entry[key] += Number(r[key]);
    entry.lastSeen = Math.max(entry.lastSeen, Number(r.last_seen));
  }
  const faces = [...byId.values()];
  const seen = faces.filter(f => f.seen > 0).length;
  const correct = faces.reduce((n,f) => n+f.correct,0), wrong = faces.reduce((n,f) => n+f.wrong,0);
  return { total:faces.length, seen, unseen:faces.length-seen, correct, wrong, faces,
    mostMissed:faces.filter(f => f.wrong).sort((a,b) => b.wrong-a.wrong || (b.wrong/(b.correct+b.wrong))-(a.wrong/(a.correct+a.wrong)) || a.name.localeCompare(b.name)).slice(0,8),
    mostCorrect:faces.filter(f => f.correct).sort((a,b) => b.correct-a.correct || a.wrong-b.wrong || a.name.localeCompare(b.name)).slice(0,8) };
}
