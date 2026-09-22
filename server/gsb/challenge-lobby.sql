-- Lobby joins, sequence revisions, ready checks and starts share one row lock.
create or replace function gsb_join_challenge(c text,a text,run_id text,expected text,candidate jsonb)
returns boolean language plpgsql as $$
declare ch gsb_sprint_challenges;
begin
  select * into ch from gsb_sprint_challenges where code=c and expires_at>now() for update;
  if ch.code is null then return false; end if;
  if exists(select 1 from gsb_sprint_runs where challenge_code=c and account_id=a) then return true; end if;
  if ch.mode='duel' and ch.starts_at is null then
    if ch.doc->>'selectionVersion' is distinct from expected then return false; end if;
    update gsb_sprint_challenges set doc=candidate where code=c returning * into ch;
    update gsb_sprint_runs set doc=candidate,ready_at=null where challenge_code=c and started_at is null;
  end if;
  -- A run joined after the count is not started here: the player's own start (sprint/start) sets its clock four seconds out.
  insert into gsb_sprint_runs(id,account_id,revision,cohort,direction,length,count,scoring_version,doc,expires_at,challenge_code,started_at)
  values(run_id,a,ch.revision,ch.cohort,ch.direction,ch.length,ch.count,ch.scoring_version,ch.doc,ch.expires_at,c,null);
  return true;
end $$;

create or replace function gsb_duel_lobby(c text,a text,version text,operation text)
returns text language plpgsql as $$
declare ch gsb_sprint_challenges;
begin
  select * into ch from gsb_sprint_challenges where code=c and expires_at>now() for update;
  if ch.code is null then return 'missing'; end if;
  if ch.mode<>'duel' then return 'mode'; end if;
  if not exists(select 1 from gsb_sprint_runs where challenge_code=c and account_id=a) then return 'member'; end if;
  if operation='begin' and ch.host_id<>a then return 'host'; end if;
  if ch.starts_at is not null then return 'ok'; end if;
  if ch.doc->>'selectionVersion' is distinct from version then return 'version'; end if;
  if operation='ready' then
    update gsb_sprint_runs set ready_at=coalesce(ready_at,now()) where challenge_code=c and account_id=a;
  else
    if exists(select 1 from gsb_sprint_runs where challenge_code=c and account_id<>a and ready_at is null and result is null) then return 'waiting'; end if;
    update gsb_sprint_challenges set starts_at=now()+interval '4 seconds' where code=c returning * into ch;
    update gsb_sprint_runs set started_at=ch.starts_at,expires_at=ch.starts_at+interval '1 hour' where challenge_code=c and result is null;
  end if;
  return 'ok';
end $$;
