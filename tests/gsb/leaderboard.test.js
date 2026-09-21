// GSB leaderboard tests cover eligibility, displayed-rating ties, and full-cohort ranking.
import test from "node:test";
import assert from "node:assert/strict";
import { loadLeaderboard, rankRatings } from "../../server/gsb/leaderboard.js";

const people = (n, options = {}) => Array.from({ length: n }, (_, i) => ({
  id: `p${String(i).padStart(3, "0")}`,
  nickname: `Player ${i}`,
  rating: 1200 - i * 10,
  games: 10,
  wins: 3,
  opponents: 5,
  defeated: 2,
  ...options,
}));

test("badges wait for ten established participants in a selected ledger", () => {
  const nine = rankRatings(people(9));
  assert.equal(nine.qualifyingCount, 9);
  assert.ok(nine.ratings.every((row) => row.badge === null));
  const ten = rankRatings(people(10));
  assert.equal(ten.ratings[0].badge, "Arjay Miller Track");
  assert.equal(ten.ratings.at(-1).badge, "FOAM Stars");
  const provisional = people(10);
  provisional[0].games = 9;
  provisional[1].opponents = 4;
  assert.equal(rankRatings(provisional).qualifyingCount, 8);
  assert.ok(rankRatings(provisional).ratings.every((row) => row.badge === null));
});

test("rounded-rating ties are consistent and boundary ties receive no badge", () => {
  const rows = people(20);
  rows[1].rating = rows[2].rating + 0.2;
  rows[2].rating = rows[1].rating - 0.2;
  const result = rankRatings(rows);
  assert.equal(result.ratings[0].badge, "Arjay Miller Track");
  assert.equal(result.ratings[1].badge, null);
  assert.equal(result.ratings[2].badge, null);
  assert.equal(result.ratings[19].badge, "FOAM Stars");
  const tied = rankRatings(people(20, { rating: 1000 }));
  assert.ok(tied.ratings.every((row) => row.badge === null));
});

test("leaderboard reads full selected population and keeps current user visible", async () => {
  const calls = [];
  const rows = people(80);
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return sql.includes("from gsb_ratings")
        ? rows
        : [{ id: "p079", nickname: "Player 79", score: "17", elapsed: "91000" }];
    },
  };
  const result = await loadLeaderboard(db, "race", "face", "p079");
  assert.equal(result.ratings.length, 80);
  assert.equal(result.qualifyingCount, 80);
  assert.equal(result.myRating.id, "p079");
  assert.equal(result.myRating.badge, "FOAM Stars");
  assert.equal(result.myBest.score, 17);
  assert.equal(result.myBest.elapsed, 91000);
  assert.deepEqual(calls.map((x) => x.params), [["race:face"], ["race", "face"]]);
  assert.ok(calls.every((x) => !/limit\s+50/i.test(x.sql)));
});

test("mode and direction are validated before database access", async () => {
  const db = { query: () => { throw new Error("unexpected read"); } };
  // @ts-expect-error Deliberately exercise a runtime-invalid mode.
  await assert.rejects(loadLeaderboard(db, "solo", "face", "p0"),
    /Invalid leaderboard/);
  // @ts-expect-error Deliberately exercise a runtime-invalid direction.
  await assert.rejects(loadLeaderboard(db, "race", "wrong", "p0"),
    /Invalid leaderboard/);
});
