// Pure coverage-first selection shared by solo play, study queues and multiplayer lobbies.
/** Select unique targets, balancing novelty across players before repeating familiar faces.
 * History maps person IDs to {seen,lastSeen}. All players receive this same sequence.
 * @param {Array<{id:string}>} cards
 * @param {Array<Record<string,{seen:number,lastSeen:number}>>} histories
 * @param {number} count
 * @param {{shuffle:Function}} rng
 * @returns {string[]}
 */
export function selectTargets(cards, histories, count, rng) {
  const players = histories.length ? histories : [{}];
  const pool = rng.shuffle([...new Map(cards.map(card => [card.id, card])).values()]);
  if (players.length === 1) {
    const h = players[0];
    return pool.sort((a,b) => (h[a.id]?.seen ?? 0)-(h[b.id]?.seen ?? 0) ||
      (h[a.id]?.lastSeen ?? 0)-(h[b.id]?.lastSeen ?? 0)).slice(0,count).map(c=>c.id);
  }
  const novel = players.map(() => 0), result = [];
  while (pool.length && result.length < count) {
    const rank = card => {
      const seen = players.map(h => h[card.id]?.seen ?? 0);
      // Shared unseen cards win. When histories diverge, novelty goes to the least-served players.
      const benefit = seen.reduce((sum, n, i) => sum + (n ? 0 : 1 / (novel[i] + 1)), 0);
      return [seen.every(n => n === 0) ? 0 : 1, -benefit,
        Math.max(...seen), seen.reduce((a, b) => a + b, 0),
        Math.max(...players.map(h => h[card.id]?.lastSeen ?? 0))];
    };
    let best = 0, score = rank(pool[0]);
    for (let i = 1; i < pool.length; i++) {
      const candidate = rank(pool[i]);
      const difference = candidate.map((n, j) => n - score[j]).find(n => n !== 0) ?? 0;
      if (difference < 0) { best = i; score = candidate; }
    }
    const [chosen] = pool.splice(best, 1);
    result.push(chosen.id);
    players.forEach((h, i) => { if (!h[chosen.id]?.seen) novel[i]++; });
  }
  return result;
}
