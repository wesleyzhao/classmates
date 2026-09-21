// Operator-only aggregate face difficulty report. No player identities or private history endpoint is exposed.
import { database } from '../../server/gsb/db.js';
const modes=new Set(['practice','speed','challenge','duel','together','race','guest']);
const mode=process.argv[2] ?? null;
if (mode && !modes.has(mode)) throw new Error(`Choose a mode: ${[...modes].join(', ')}`);
const rows=await database().query(`select p.name,sum(t.seen)::int as offered,
  sum(t.correct)::int as first_right,sum(t.wrong)::int as first_wrong,
  sum(t.attempts)::int as attempts,sum(t.mistakes)::int as wrong_taps,
  count(distinct t.account_id)::int as players,
  round(100.0*sum(t.correct)/nullif(sum(t.correct+t.wrong),0),1) as first_accuracy_percent
  from gsb_face_totals t join gsb_people p on p.id=t.person_id
  where not p.excluded and ($1::text is null or t.mode=$1)
  group by p.id,p.name order by first_wrong desc,offered desc,p.name`,[mode]);
console.table(rows);
