// GSB standings rank the complete mode-and-direction cohort before assigning percentile badges.

export const RANKING_RULES = Object.freeze({
  minimumGames: 10,
  minimumOpponents: 5,
  minimumQualifiers: 10,
  percentile: 0.1,
});

const TOP_BADGE = "Arjay Miller Track";
const BOTTOM_BADGE = "FOAM Stars";

/** @typedef {{id:string,nickname:string,rating:number,games:number,wins:number,opponents:number,defeated:number,badge:string|null,qualified:boolean,rank:number|null}} RatingRow */

/**
 * Rank all participants in one rating ledger. A tie at the percentile boundary
 * is left unbadged so equal displayed ratings always receive the same label.
 * @param {Array<Record<string, unknown>>} rows
 * @param {typeof RANKING_RULES} [rules]
 * @returns {{ratings:RatingRow[],qualifyingCount:number}}
 */
export function rankRatings(rows, rules = RANKING_RULES) {
  const ratings = rows.map((row) => ({
    id: String(row.id),
    nickname: String(row.nickname ?? ""),
    rating: Math.round(Number(row.rating)),
    games: Number(row.games),
    wins: Number(row.wins),
    opponents: Number(row.opponents),
    defeated: Number(row.defeated),
    badge: null,
    qualified: Number(row.games) >= rules.minimumGames &&
      Number(row.opponents) >= rules.minimumOpponents,
    rank: null,
  }));
  ratings.sort((a, b) => b.rating - a.rating || b.wins - a.wins ||
    a.id.localeCompare(b.id));
  const qualifying = ratings.filter((row) => row.qualified);
  const count = qualifying.length;
  let previousRating = null, rank = 0;
  for (let i = 0; i < count; i++) {
    const row = qualifying[i];
    if (row.rating !== previousRating) rank = i + 1;
    row.rank = rank;
    previousRating = row.rating;
  }
  if (count >= rules.minimumQualifiers) {
    const size = Math.floor(count * rules.percentile);
    if (size > 0 && qualifying[0].rating !== qualifying.at(-1).rating) {
      for (let start = 0; start < count;) {
        let end = start + 1;
        while (end < count && qualifying[end].rating === qualifying[start].rating)
          end++;
        if (end <= size) {
          for (let i = start; i < end; i++) qualifying[i].badge = TOP_BADGE;
        } else if (start >= count - size) {
          for (let i = start; i < end; i++) qualifying[i].badge = BOTTOM_BADGE;
        }
        start = end;
      }
    }
  }
  return { ratings, qualifyingCount: count };
}

/**
 * Load every rating and personal best for a selected GSB mode and direction.
 * The full rating cohort is needed to compute honest percentile boundaries
 * and to keep the current user's row and the bottom band discoverable.
 * @param {{query:(sql:string,params:unknown[])=>Promise<Array<Record<string,unknown>>>}} db
 * @param {"race"|"together"} mode
 * @param {"face"|"name"|"mixed"} direction
 * @param {string} accountId
 */
export async function loadLeaderboard(db, mode, direction, accountId) {
  if (!["race", "together"].includes(mode) ||
    !["face", "name", "mixed"].includes(direction))
    throw new Error("Invalid leaderboard mode or direction.");
  const key = `${mode}:${direction}`;
  const [ratingRows, bestRows] = await Promise.all([
    db.query(
      `select a.nickname,r.account_id as id,round(r.rating::numeric)::int as rating,
        r.games,r.wins,coalesce(o.opponents,0)::int as opponents,
        coalesce(o.defeated,0)::int as defeated
       from gsb_ratings r
       join gsb_accounts a on a.id=r.account_id
       left join (
         select account_id,mode,count(*)::int as opponents,
           count(*) filter (where wins>0)::int as defeated
         from gsb_opponents group by account_id,mode
       ) o on o.account_id=r.account_id and o.mode=r.mode
       where r.mode=$1`,
      [key],
    ),
    db.query(
      `select a.id,a.nickname,max((r->>'score')::integer) as score,
        min((r->>'elapsedMs')::integer) as elapsed
       from gsb_matches m cross join lateral jsonb_array_elements(m.results) r
       join gsb_accounts a on a.id=r->>'playerId'
       where m.mode=$1 and m.direction=$2 and not m.void
         and (r->>'correct')::integer>0
       group by a.id,a.nickname
       order by score desc,elapsed asc nulls last,a.id`,
      [mode, direction],
    ),
  ]);
  const { ratings, qualifyingCount } = rankRatings(ratingRows);
  const best = bestRows.map((row) => ({
    id: String(row.id),
    nickname: String(row.nickname ?? ""),
    score: Number(row.score),
    elapsed: row.elapsed === null ? null : Number(row.elapsed),
  }));
  return {
    ratings,
    best,
    mode,
    direction,
    qualifyingCount,
    badgeThreshold: RANKING_RULES.minimumQualifiers,
    myRating: ratings.find((row) => row.id === accountId) ?? null,
    myBest: best.find((row) => row.id === accountId) ?? null,
  };
}
