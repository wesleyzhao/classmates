// Bounded JSON requests shared by screens and background saves, independent of presentation.
/** Fetch JSON, preserving a caller's payload across one server conflict retry.
 * Mutations are never retried automatically after a timeout: the server may have committed.
 * @param {string} path
 * @param {any} [body]
 * @param {{signal?:AbortSignal,timeoutMs?:number,keepalive?:boolean}} [options]
 */
export async function api(path, body, { signal, timeoutMs = 20000, keepalive = false } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeoutMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let res, data;
      try {
        res = await fetch(`/api/${path}`, {
          signal: controller.signal, keepalive,
          ...(body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }),
        });
        if (res.status === 401 && typeof window !== 'undefined')
          window.dispatchEvent(new Event('gsb:session-lost'));
        data = await res.json();
      } catch {
        if (controller.signal.aborted) throw new Error(timedOut
          ? 'Connection took too long. Please try again.' : 'Request cancelled.');
        const error = new Error(res ? 'The server could not respond. Please try again.' : 'Connection lost. Please try again.');
        if (res && !res.ok) error['status'] = res.status;
        throw error;
      }
      if (res.ok) return data;
      if (data?.code === 'busy' && !attempt) continue;
      const error = new Error(data?.error || 'Something went wrong. Please try again.');
      error['status'] = res.status;
      throw error;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
