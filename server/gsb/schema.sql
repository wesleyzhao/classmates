-- GSB private content, passwordless identity, study progress, and atomic multiplayer results.
create table if not exists gsb_accounts(id text primary key,email text unique not null,nickname text not null default '',created_at timestamptz not null default now());
create table if not exists gsb_sessions(hash text primary key,account_id text not null references gsb_accounts(id),expires_at timestamptz not null);
create index if not exists gsb_sessions_expiry on gsb_sessions(expires_at);
create table if not exists gsb_links(hash text primary key,email text not null,expires_at timestamptz not null);
-- Owner previews are explicit, short-lived grants, never evidence of email verification.
alter table gsb_accounts add column if not exists email_verified_at timestamptz;
alter table gsb_links add column if not exists origin text;
alter table gsb_links add column if not exists purpose text not null default 'email';
alter table gsb_sessions add column if not exists purpose text not null default 'email';
create table if not exists gsb_people(id text primary key,name text not null,blob_path text not null,revision text not null,excluded boolean not null default false);
create table if not exists gsb_assets(id text primary key,person_id text not null references gsb_people(id),path text not null);
create table if not exists gsb_revisions(id text primary key,cards jsonb not null,created_at timestamptz not null default now());
create table if not exists gsb_progress(account_id text not null references gsb_accounts(id),person_id text not null references gsb_people(id),direction text not null,doc jsonb not null,primary key(account_id,person_id,direction));
create table if not exists gsb_reviews(id text primary key,account_id text not null references gsb_accounts(id),created_at timestamptz not null default now());
-- Guest rounds are private, unranked practice capabilities. Expiry and live exclusions still gate reads.
create table if not exists gsb_guest_runs(hash text primary key,doc jsonb not null,expires_at timestamptz not null,finished_at timestamptz,claimed_account_id text references gsb_accounts(id));
create index if not exists gsb_guest_runs_expiry on gsb_guest_runs(expires_at);
create index if not exists gsb_guest_runs_claimed on gsb_guest_runs(claimed_account_id) where claimed_account_id is not null;
-- Solo sprint attempts retain completed results; only expired unfinished attempts are cleaned up.
create table if not exists gsb_sprint_runs(id text primary key,account_id text not null references gsb_accounts(id),revision text not null,cohort text not null,direction text not null,length text not null,count integer not null,scoring_version integer not null,doc jsonb not null,created_at timestamptz not null default now(),started_at timestamptz,expires_at timestamptz not null,finished_at timestamptz,result jsonb);
create index if not exists gsb_sprint_runs_expiry on gsb_sprint_runs(expires_at) where finished_at is null;
create index if not exists gsb_sprint_runs_records on gsb_sprint_runs(revision,cohort,direction,length,count,scoring_version,finished_at) where result is not null;
create index if not exists gsb_sprint_runs_personal on gsb_sprint_runs(account_id,revision,cohort,direction,length,count,scoring_version) where result is not null;
-- Speed challenges share one question sequence between classmates; each account plays it once, locally, and the standings compare results.
create table if not exists gsb_sprint_challenges(code text primary key,host_id text not null references gsb_accounts(id),revision text not null,cohort text not null,direction text not null,length text not null,count integer not null,scoring_version integer not null,doc jsonb not null,created_at timestamptz not null default now(),expires_at timestamptz not null);
alter table gsb_sprint_runs add column if not exists challenge_code text;
create unique index if not exists gsb_sprint_runs_challenge on gsb_sprint_runs(challenge_code,account_id) where challenge_code is not null;
-- Duels: a two-door challenge everyone starts on the same count, with live progress and a rematch pointer.
alter table gsb_sprint_challenges add column if not exists mode text not null default 'solo';
alter table gsb_sprint_challenges add column if not exists starts_at timestamptz;
alter table gsb_sprint_challenges add column if not exists next_code text;
alter table gsb_sprint_runs add column if not exists ready_at timestamptz;
alter table gsb_sprint_runs add column if not exists progress jsonb;
-- Operator switches read at request time, so they change without a deploy. The test door lives here.
create table if not exists gsb_settings(key text primary key,value jsonb not null,updated_at timestamptz not null default now());
create table if not exists gsb_matches(id text primary key,mode text not null,direction text not null,revision text not null,finished_at timestamptz not null,results jsonb not null,void boolean not null default false);
create index if not exists gsb_matches_finished on gsb_matches(finished_at desc);
create table if not exists gsb_ratings(account_id text not null references gsb_accounts(id),mode text not null,rating double precision not null default 1000,games integer not null default 0,wins integer not null default 0,primary key(account_id,mode));
create table if not exists gsb_opponents(account_id text not null,opponent_id text not null,mode text not null,wins integer not null default 0,primary key(account_id,opponent_id,mode));
create table if not exists gsb_pair_days(low_id text not null,high_id text not null,mode text not null,day date not null,primary key(low_id,high_id,mode,day));

-- This single transaction commits a room and its match exactly once. Completion serializes
-- the small rating ledger so concurrent rooms cannot lose updates or rate the same pair twice.
create or replace function gsb_commit_room(p_code text,p_version integer,p_doc jsonb,p_result jsonb)
returns integer language plpgsql as $$
declare new_v integer; item jsonb; rival jsonb; my_rating double precision; their_rating double precision;
  delta double precision; result double precision; n integer; inserted integer; mode_key text; match_day date;
  before_ratings jsonb := '{}'::jsonb; deltas jsonb := '{}'::jsonb; eligible boolean;
begin
  update rooms set doc=p_doc,v=v+1,updated_at=now() where code=p_code and v=p_version returning v into new_v;
  if new_v is null then return null; end if;
  if p_result is null then return new_v; end if;
  perform pg_advisory_xact_lock(732027);
  insert into gsb_matches(id,mode,direction,revision,finished_at,results,void)
  values(p_result->>'id',p_result->>'mode',p_result->>'direction',p_result->>'revision',to_timestamp((p_result->>'finishedAt')::double precision/1000),p_result->'results',coalesce((p_result->>'void')::boolean,false))
  on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 or (p_result->>'void')::boolean then return new_v; end if;
  n=jsonb_array_length(p_result->'results');
  if n<2 or not exists(select 1 from jsonb_array_elements(p_result->'results') r where (r->>'correct')::integer>0) then return new_v; end if;
  mode_key=(p_result->>'mode')||':'||(p_result->>'direction');
  match_day=(to_timestamp((p_result->>'finishedAt')::double precision/1000) at time zone 'America/Los_Angeles')::date;
  for item in select value from jsonb_array_elements(p_result->'results') loop
    insert into gsb_ratings(account_id,mode) values(item->>'playerId',mode_key) on conflict do nothing;
    select rating into my_rating from gsb_ratings where account_id=item->>'playerId' and mode=mode_key;
    before_ratings=before_ratings||jsonb_build_object(item->>'playerId',my_rating);
    deltas=deltas||jsonb_build_object(item->>'playerId',0);
  end loop;
  for item in select value from jsonb_array_elements(p_result->'results') loop
    for rival in select value from jsonb_array_elements(p_result->'results') loop
      if item->>'playerId' >= rival->>'playerId' then continue; end if;
      insert into gsb_pair_days values(item->>'playerId',rival->>'playerId',mode_key,match_day) on conflict do nothing;
      get diagnostics inserted=row_count;
      if inserted=0 then continue; end if;
      my_rating=(before_ratings->>(item->>'playerId'))::double precision;
      their_rating=(before_ratings->>(rival->>'playerId'))::double precision;
      result=case when (item->>'rank')::integer<(rival->>'rank')::integer then 1 when (item->>'rank')::integer=(rival->>'rank')::integer then 0.5 else 0 end;
      delta=24.0/(n-1)*(result-1/(1+power(10,(their_rating-my_rating)/400)));
      deltas=jsonb_set(deltas,array[item->>'playerId'],to_jsonb((deltas->>(item->>'playerId'))::double precision+delta));
      deltas=jsonb_set(deltas,array[rival->>'playerId'],to_jsonb((deltas->>(rival->>'playerId'))::double precision-delta));
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(p_result->'results') loop
    update gsb_ratings set rating=rating+(deltas->>(item->>'playerId'))::double precision,games=games+1,
      wins=wins+case when (item->>'rank')::integer=1 and (item->>'correct')::integer>0 then 1 else 0 end
      where account_id=item->>'playerId' and mode=mode_key;
    for rival in select value from jsonb_array_elements(p_result->'results') loop
      if item->>'playerId'=rival->>'playerId' then continue; end if;
      insert into gsb_opponents values(item->>'playerId',rival->>'playerId',mode_key,case when (item->>'rank')::integer<(rival->>'rank')::integer then 1 else 0 end)
      on conflict(account_id,opponent_id,mode) do update set wins=gsb_opponents.wins+excluded.wins;
    end loop;
  end loop;
  return new_v;
end $$;

-- Review IDs prevent a retry from advancing memory twice. Row locking serializes devices.
create or replace function gsb_review(p_id text,p_account text,p_person text,p_direction text,p_correct boolean,p_now bigint)
returns jsonb language plpgsql as $$
-- One memory per person for both directions, in the shape of Anki's schedule for a pass-or-fail card:
-- learning steps of one and ten minutes, graduation to a day, intervals multiplied by an ease of 2.5 (never
-- under 1.3, capped at half a year), a lapse on a missed review that lowers the ease and relearns from a minute.
-- Misses are counted per direction so the weaker direction is asked first. public/gsb/learning.js mirrors this.
declare previous jsonb; legacy record; inserted integer;
  ease numeric; interval_ms bigint; lapses integer; state text; step integer; due bigint; reviews integer; correct integer; missed jsonb; stage integer;
  steps bigint[]:=array[60000,600000]; day constant bigint:=86400000;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_account||p_person,0));
  select doc into previous from gsb_progress where account_id=p_account and person_id=p_person and direction='both';
  if previous is null then
    -- Lifetime counts carry over from the older per-direction records; the schedule itself starts fresh.
    select coalesce(sum((doc->>'reviews')::integer),0) as reviews,coalesce(sum((doc->>'correct')::integer),0) as correct,
      coalesce(sum(case when direction='face' then (doc->>'reviews')::integer-(doc->>'correct')::integer else 0 end),0) as face,
      coalesce(sum(case when direction='name' then (doc->>'reviews')::integer-(doc->>'correct')::integer else 0 end),0) as name
      into legacy from gsb_progress where account_id=p_account and person_id=p_person and direction in ('face','name');
    if legacy.reviews>0 then
      previous=jsonb_build_object('reviews',legacy.reviews,'correct',legacy.correct,'missed',jsonb_build_object('face',legacy.face,'name',legacy.name),'lapses',0,'state','learning','step',0,'ease',2.5,'interval',0);
    end if;
  end if;
  insert into gsb_reviews(id,account_id) values(p_id,p_account) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 then return previous; end if;
  perform gsb_observe(p_account,'practice:'||p_id,'0',p_person,'practice',p_direction,1,p_correct::int,(not p_correct)::int,1,(not p_correct)::int,to_timestamp(p_now::double precision/1000));
  ease=coalesce((previous->>'ease')::numeric,2.5); interval_ms=coalesce((previous->>'interval')::bigint,0);
  lapses=coalesce((previous->>'lapses')::integer,0); state=coalesce(previous->>'state','learning'); step=coalesce((previous->>'step')::integer,0);
  reviews=coalesce((previous->>'reviews')::integer,0)+1; correct=coalesce((previous->>'correct')::integer,0)+p_correct::integer;
  missed=coalesce(previous->'missed','{"face":0,"name":0}'::jsonb);
  if p_correct then
    if state='review' then
      interval_ms=least(greatest(floor(interval_ms*ease)::bigint,interval_ms+day),180*day); due=p_now+interval_ms;
    elsif state='learning' and step<array_length(steps,1)-1 then
      step=step+1; due=p_now+steps[step+1];
    else
      state='review'; step=0; interval_ms=day; due=p_now+day;
    end if;
  else
    if state='review' then lapses=lapses+1; ease=greatest(1.3,round(ease-0.2,2)); end if;
    state=case when state='learning' then 'learning' else 'relearning' end;
    step=0; interval_ms=0; due=p_now+steps[1];
    missed=jsonb_set(missed,array[p_direction],to_jsonb(coalesce((missed->>p_direction)::integer,0)+1));
  end if;
  stage=case when state='review' then least(9,2+greatest(0,round(ln(greatest(1,interval_ms::numeric/day))/ln(2.5))::integer)) else step end;
  previous=jsonb_build_object('state',state,'step',step,'ease',ease,'interval',interval_ms,'lapses',lapses,'dueAt',due,'reviews',reviews,'correct',correct,'lastAt',p_now,'lastDirection',p_direction,'missed',missed,'stage',stage,'leech',((missed->>'face')::integer+(missed->>'name')::integer)>=8);
  insert into gsb_progress values(p_account,p_person,'both',previous) on conflict(account_id,person_id,direction) do update set doc=excluded.doc;
  return previous;
end $$;
