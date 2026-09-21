// One prepared sequence can offer smaller runs without fetching questions or private photos again.
/** Keep server-issued, non-overlapping runs available until played or disposed by the controller.
 * The caller owns the shared media; offsets translate a run's lookahead into that media's sequence.
 * @param {{id:string,length:string,count:number,questions:any[],records?:any,quickRecords?:any,segments?:Array<{id:string,length:string,count:number,offset:number}>}} data
 */
export function createSprintBuffer(data) {
  const { segments = [], quickRecords, ...whole } = data;
  const runs = [{ ...whole, mediaOffset: 0 }, ...segments.map(s => ({
    ...whole, id: s.id, length: s.length, count: s.count, mediaOffset: s.offset,
    questions: whole.questions.slice(s.offset, s.offset + s.count), records: quickRecords,
  }))];
  const used = new Set();
  const available = run => !run.questions.some(q => used.has(q.id));
  const updateRecords = (length, records) => {
    for (const run of runs) if (run.length === length) run.records = records;
    return records;
  };
  return {
    get(length) { return runs.find(run => run.length === length && available(run)) ?? null; },
    updateRecords,
    record(id, result) {
      const run = runs.find(run => run.id === id);
      if (!run) return null;
      const records = { ...run.records }, best = records.bestScore, perfect = records.fastestPerfect;
      if (!best || result.score > best.score || (result.score === best.score && result.elapsedMs < best.elapsedMs)) records.bestScore = result;
      if (result.perfect && (!perfect || result.elapsedMs < perfect.elapsedMs)) records.fastestPerfect = result;
      // Only a server-confirmed result comes here. Class standings refresh from the records API.
      return updateRecords(run.length, records);
    },
    consume(id) {
      const run = runs.find(run => run.id === id);
      if (run) for (const q of run.questions) used.add(q.id);
    },
  };
}
