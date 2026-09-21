// Durable, account-scoped partial-run history. Local taps never wait for a request.
import { api } from './api.js';

// Navigation can mount another round before the previous controller finishes flushing.
// Share its queue so the old response cannot erase a newer controller's saved prefix.
const queues = new Map();
/** Queue the latest visited prefix per run and batch it at lifecycle boundaries.
 * @param {string} accountId
 * @param {{storage?:Storage,send?:(body:any)=>Promise<any>}} [options]
 */
export function createFaceCheckpoints(accountId, options={}) {
  const shared = !options.storage && !options.send;
  if (shared && queues.has(accountId)) return queues.get(accountId);
  let storage = options.storage;
  try { storage ??= sessionStorage; } catch {}
  const key = `gsb-face-checkpoints:${accountId}`, pending = Object.create(null);
  let flushing = null;
  try {
    const restored = JSON.parse(storage?.getItem(key));
    if (restored && !Array.isArray(restored) && typeof restored === 'object')
      for (const [id,value] of Object.entries(restored)) {
        if (value?.id !== id || !Array.isArray(value.answers) || value.answers.length > 600 ||
            !value.answers.every(choice => typeof choice === 'string' && /^[0-3]$/.test(choice)) ||
            !Number.isInteger(value.seen) || value.seen < value.answers.length || value.seen > value.answers.length+1) continue;
        pending[id] = value;
      }
  } catch {}
  const persist = () => { try { storage?.setItem(key,JSON.stringify(pending)); } catch {} };
  const send = options.send ?? (body => api('sprint/history',body,{keepalive:true,timeoutMs:8000}));
  const flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      const attempted = new Set();
      // Drain new prefixes added during a request, but never spin on a failed value.
      for (;;) {
        const entry = Object.entries(pending).find(([,value]) => !attempted.has(value));
        if (!entry) break;
        const [id,value] = entry;
        attempted.add(value);
        try { await send(value); }
        catch (e) { if (![400,404,409,410].includes(e.status)) continue; }
        if (pending[id] === value) delete pending[id];
        persist();
      }
    })().finally(() => { flushing=null; });
    return flushing;
  };
  const queue = {
    remember(round, answers) {
      pending[round.id] = {id:round.id,epoch:round.historyEpoch ?? '0',answers:answers.map(a=>a.choice),seen:Math.min(answers.length+1,round.count)};
      persist();
    },
    forget(id) { delete pending[id]; persist(); },
    flush,
  };
  if (shared) queues.set(accountId,queue);
  return queue;
}
