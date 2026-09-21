-- Idempotent per-question receipts plus compact indexed totals. Source writes and history commit together.
create table if not exists gsb_face_observations(
  account_id text not null references gsb_accounts(id) on delete cascade,
  source text not null, question text not null, person_id text not null references gsb_people(id),
  mode text not null, direction text not null, seen integer not null, correct integer not null,
  wrong integer not null, attempts integer not null, mistakes integer not null, last_seen timestamptz not null,
  primary key(account_id,source,question),
  check(seen>=correct+wrong and correct>=0 and wrong>=0 and attempts>=correct+wrong and mistakes>=wrong and attempts>=mistakes)
);
create table if not exists gsb_face_totals(
  account_id text not null references gsb_accounts(id) on delete cascade,
  person_id text not null references gsb_people(id),mode text not null,direction text not null,
  seen integer not null,correct integer not null,wrong integer not null,attempts integer not null,mistakes integer not null,last_seen timestamptz not null,
  primary key(account_id,person_id,mode,direction)
);

-- The receipt upsert is monotonic. Concurrent replays cannot count a question twice.
create or replace function gsb_observe(a text,s text,q text,p text,m text,d text,n integer,c integer,w integer,t integer,x integer,at_time timestamptz)
returns void language plpgsql as $$
begin
  if not exists(select 1 from gsb_people where id=p and not excluded) then return; end if;
  insert into gsb_face_observations values(a,s,q,p,m,d,n,c,w,t,x,at_time)
  on conflict(account_id,source,question) do update set
    seen=greatest(gsb_face_observations.seen,excluded.seen),
    correct=greatest(gsb_face_observations.correct,excluded.correct),
    wrong=greatest(gsb_face_observations.wrong,excluded.wrong),
    attempts=greatest(gsb_face_observations.attempts,excluded.attempts),
    mistakes=greatest(gsb_face_observations.mistakes,excluded.mistakes)
  where gsb_face_observations.seen<excluded.seen or gsb_face_observations.attempts<excluded.attempts;
end $$;

create or replace function gsb_sum_face_observation() returns trigger language plpgsql as $$
declare n integer:=0; c integer:=0; w integer:=0; t integer:=0; x integer:=0;
begin
  if TG_OP='UPDATE' then n=old.seen;c=old.correct;w=old.wrong;t=old.attempts;x=old.mistakes; end if;
  insert into gsb_face_totals values(new.account_id,new.person_id,new.mode,new.direction,new.seen-n,new.correct-c,new.wrong-w,new.attempts-t,new.mistakes-x,new.last_seen)
  on conflict(account_id,person_id,mode,direction) do update set
    seen=gsb_face_totals.seen+excluded.seen,correct=gsb_face_totals.correct+excluded.correct,
    wrong=gsb_face_totals.wrong+excluded.wrong,attempts=gsb_face_totals.attempts+excluded.attempts,
    mistakes=gsb_face_totals.mistakes+excluded.mistakes,last_seen=greatest(gsb_face_totals.last_seen,excluded.last_seen);
  return new;
end $$;
drop trigger if exists gsb_face_sum on gsb_face_observations;
create trigger gsb_face_sum after insert or update on gsb_face_observations for each row execute function gsb_sum_face_observation();

-- Partial speed rounds keep a validated monotonic prefix. Merely preparing a round contributes nothing.
alter table gsb_sprint_runs add column if not exists history jsonb;
create or replace function gsb_sprint_history() returns trigger language plpgsql as $$
declare q jsonb; i integer; answered jsonb; seen_count integer; choice text; right_answer boolean; mode_key text;
begin
  if new.started_at is null then return new; end if;
  answered=coalesce(new.result->'answers',new.history->'answers','[]'::jsonb);
  seen_count=case when new.result is not null then jsonb_array_length(new.doc->'questions') else coalesce((new.history->>'seen')::integer,0) end;
  mode_key=case when new.challenge_code is null then 'speed' when coalesce((new.doc->>'choices')::integer,4)=2 then 'duel' else 'challenge' end;
  -- Stable person order avoids deadlocks when concurrent runs share several targets.
  for q,i in select value,(ordinality-1)::int from jsonb_array_elements(new.doc->'questions') with ordinality where ordinality<=seen_count order by value->>'target' loop
    choice=answered->>i;
    right_answer=choice is not null and q->'options'->>(choice::int)=q->>'target';
    perform gsb_observe(new.account_id,'sprint:'||new.id||':'||coalesce(new.doc->>'historyEpoch','0'),q->>'id',q->>'target',mode_key,q->>'direction',1,
      (choice is not null and right_answer)::int,(choice is not null and not right_answer)::int,
      (choice is not null)::int,(choice is not null and not right_answer)::int,coalesce(new.finished_at,new.started_at));
  end loop;
  return new;
end $$;
drop trigger if exists gsb_sprint_history_write on gsb_sprint_runs;
create trigger gsb_sprint_history_write after insert or update of history,result on gsb_sprint_runs for each row execute function gsb_sprint_history();

create or replace function gsb_checkpoint_sprint(run_id text,a text,h jsonb) returns boolean language plpgsql as $$
declare r gsb_sprint_runs; i integer; prefix jsonb;
begin
  select * into r from gsb_sprint_runs where id=run_id and account_id=a for update;
  if r.id is null or r.started_at is null or r.started_at>now() or r.expires_at<=now() then return false; end if;
  if coalesce(r.doc->>'historyEpoch','0') is distinct from h->>'epoch' then return false; end if;
  prefix=coalesce(r.result->'answers',r.history->'answers','[]'::jsonb);
  for i in 0..least(jsonb_array_length(prefix),jsonb_array_length(h->'answers'))-1 loop
    if prefix->i is distinct from h->'answers'->i then return false; end if;
  end loop;
  if r.result is not null then return true; end if;
  if jsonb_array_length(prefix)>jsonb_array_length(h->'answers') then return true; end if;
  update gsb_sprint_runs set history=h where id=run_id;
  return true;
end $$;

-- Room history is server-authored. Losing a room CAS never reaches this trigger.
create or replace function gsb_room_history() returns trigger language plpgsql as $$
declare s jsonb; player record; q jsonb; i integer; h jsonb; attempts integer; misses integer; first_right boolean;
begin
  s=new.doc->'s';
  if new.doc->'game'->>'kitId'<>'recognition' or s->'_seen' is null or coalesce((s->>'void')::boolean,false) then return new; end if;
  for player in select key,value from jsonb_each(s->'_seen') order by key loop
    if not exists(select 1 from gsb_accounts where id=player.key) then continue; end if;
    for q,i in select value,(ordinality-1)::int from jsonb_array_elements(s->'_order') with ordinality where ordinality<=player.value::int order by value->>'target' loop
      h=s->'_history'->player.key->(q->>'id');
      if s->>'$seed'=old.doc->'s'->>'$seed' and i<coalesce((old.doc->'s'->'_seen'->>player.key)::int,0) and h is not distinct from old.doc->'s'->'_history'->player.key->(q->>'id') then continue; end if;
      attempts=coalesce((h->>'attempts')::int,0);misses=coalesce((h->>'mistakes')::int,0);first_right=(h->>'firstCorrect')::boolean;
      perform gsb_observe(player.key,'room:'||(s->>'$seed'),q->>'id',q->>'target',s->>'mode',q->>'direction',1,
        coalesce(first_right::int,0),coalesce((not first_right)::int,0),attempts,misses,to_timestamp((new.doc->>'updatedAt')::double precision/1000));
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists gsb_room_history_write on rooms;
create trigger gsb_room_history_write after update of doc on rooms for each row when (old.doc->'s' is distinct from new.doc->'s') execute function gsb_room_history();

create or replace function gsb_guest_history() returns trigger language plpgsql as $$
declare q jsonb; i integer; a jsonb; chosen boolean;
begin
  if new.claimed_account_id is null or new.doc->'result' is null then return new; end if;
  for q,i in select value,(ordinality-1)::int from jsonb_array_elements(new.doc->'questions') with ordinality order by value->>'target' loop
    a=new.doc->'result'->'answers'->i; chosen=a->>'choice' is not null;
    perform gsb_observe(new.claimed_account_id,'guest:'||new.hash,q->>'id',q->>'target','guest','face',1,
      (chosen and (a->>'correct')::boolean)::int,(chosen and not (a->>'correct')::boolean)::int,chosen::int,
      (chosen and not (a->>'correct')::boolean)::int,new.finished_at);
  end loop;
  return new;
end $$;
drop trigger if exists gsb_guest_history_write on gsb_guest_runs;
create trigger gsb_guest_history_write after update of claimed_account_id on gsb_guest_runs for each row execute function gsb_guest_history();
