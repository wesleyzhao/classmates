// Account names are presentation only; one atomic write updates current room displays as well.
import { normalizeNickname, nicknameError } from "../../public/gsb/profile.js";
import { PlatformError } from "../../public/shared/errors.js";

/** Save a nickname without changing account identity, game state, or the rating ledger.
 * @param {{query: (sql: string, params?: any[]) => Promise<any>}} db
 * @param {string} accountId
 * @param {unknown} raw
 * @returns {Promise<string>}
 */
export async function saveNickname(db, accountId, raw) {
  const nickname = normalizeNickname(raw), error = nicknameError(nickname);
  if (error) throw new PlatformError(400, "nickname", error);
  // Increment both versions so an in-flight game write retries against the renamed room.
  // Aggregate in seat order; only the matching player's presentation field is replaced.
  await db.query(`with renamed as (
    update gsb_accounts set nickname=$2 where id=$1 returning id,nickname
  )
  update rooms r set
    doc=r.doc || jsonb_build_object(
      'players', (select jsonb_agg(
        case when player->>'id'=a.id then player || jsonb_build_object('name',a.nickname)
          else player end order by ordinal
      ) from jsonb_array_elements(r.doc->'players') with ordinality as p(player,ordinal)),
      'v',r.v+1,'updatedAt',floor(extract(epoch from now())*1000)::bigint),
    v=r.v+1,updated_at=now()
  from renamed a
  where r.doc->'players' @> jsonb_build_array(jsonb_build_object('id',a.id))
    and exists(select 1 from jsonb_array_elements(r.doc->'players') player
      where player->>'id'=a.id and player->>'name' is distinct from a.nickname)`,
  [accountId, nickname]);
  return nickname;
}
