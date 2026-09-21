# GSB rankings

Multiplayer Elo ratings are separate for each game mode and question direction. The leaderboard loads the complete selected ledger, so bottom-ranked classmates and the current player remain visible. Personal bests use the same selected mode and direction.

Only established participants qualify for percentile labels: at least 10 rated games and 5 distinct opponents in that ledger. Labels appear once at least 10 participants qualify. The highest 10% receive “Arjay Miller Track”; the lowest 10% receive “FOAM Stars.” The quota is rounded down, so 19 qualifiers label one at each end and 20 label two. A tie in the displayed rounded rating at a cutoff leaves the entire tied group unbadged. If all displayed ratings tie, no labels appear.

The thresholds live together in `RANKING_RULES` in `server/gsb/leaderboard.js`. This can be adjusted after the class chooses its preferred eligibility rules. Provisional players still appear in the table, without a percentile label or qualifying rank.

`loadLeaderboard(db, mode, direction, accountId)` returns `{ ratings, best, mode, direction, qualifyingCount, badgeThreshold, myRating, myBest }`. Every rating row includes `badge` (`null` or one of the two labels), `qualified`, and `rank` (the qualifying rank, or `null`). The router calls this function and sends its result as JSON. The client shows the badge alongside the nickname, highlights the current player's row, and keeps the whole field in a bounded scrolling table.
