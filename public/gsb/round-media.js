// A round owns its preloaded private images; no fetch or shared-cache eviction can interrupt a sprint.
/** Preload a bounded round with six concurrent fetches, then decode only its next few images.
 * @param {Array<{image?:string,choices:Array<{image?:string}>}>} questions
 * @param {{signal?:AbortSignal,onProgress?:(loaded:number,total:number)=>void,stallMs?:number}} [options]
 */
export async function prepareRoundMedia(questions, { signal, onProgress = () => {}, stallMs = 20000 } = {}) {
  const sources = [...new Set(questions.flatMap(q => [q.image, ...q.choices.map(c => c.image)]).filter(Boolean))];
  if (sources.length > 600) throw new Error("This round has too many photos.");
  const urls = new Map(), decoded = new Map();
  const controller = new AbortController();
  let index = 0, loaded = 0, disposed = false;
  let stalled, rejectWait;
  const interrupted = new Promise((_, reject) => { rejectWait = reject; });
  const pulse = () => {
    clearTimeout(stalled);
    stalled = setTimeout(() => rejectWait(new Error("Photo loading stalled. Please retry before starting.")), stallMs);
  };
  const cancelled = () => rejectWait(new Error("Photo loading was cancelled."));
  controller.signal.addEventListener("abort", cancelled, { once: true });
  const dispose = () => {
    if (disposed) return;
    disposed = true; controller.abort();
    clearTimeout(stalled);
    signal?.removeEventListener("abort", dispose);
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear(); decoded.clear();
  };
  signal?.addEventListener("abort", dispose, { once: true });
  if (signal?.aborted) dispose();
  const worker = async () => {
    while (index < sources.length) {
      const src = sources[index++];
      const res = await fetch(src, { cache: "no-store", signal: controller.signal });
      if (res.status === 401) window.dispatchEvent(new Event("gsb:session-lost"));
      if (!res.ok) throw new Error("A photo could not load. Please retry before starting.");
      const blob = await res.blob();
      if (disposed) throw new Error("Photo loading was cancelled.");
      const url = URL.createObjectURL(blob);
      urls.set(src, url);
      const check = new Image();
      check.src = url;
      await check.decode();
      if (disposed) throw new Error("Photo loading was cancelled.");
      pulse();
      onProgress(++loaded, sources.length);
    }
  };
  // Retain decoded image objects only around the current question, not the entire class.
  const warm = async (start) => {
    if (disposed) return;
    const wanted = new Set(questions.slice(start, start + 6)
      .flatMap(q => [q.image, ...q.choices.map(c => c.image)]).filter(Boolean));
    for (const src of decoded.keys()) if (!wanted.has(src)) decoded.delete(src);
    await Promise.all([...wanted].map(async src => {
      if (decoded.has(src)) return decoded.get(src).ready;
      const img = new Image();
      img.src = urls.get(src);
      const ready = img.decode();
      decoded.set(src, { img, ready });
      await ready;
    }));
  };
  try {
    pulse();
    await Promise.race([interrupted, (async () => {
      await Promise.all(Array.from({ length: Math.min(6, sources.length) }, worker));
      await warm(0);
    })()]);
    return { urls, warm, dispose };
  } catch (error) { dispose(); throw error; }
  finally { clearTimeout(stalled); controller.signal.removeEventListener("abort", cancelled); }
}
