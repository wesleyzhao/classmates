-- Import recoverable history once. Old combined Practice memories cannot recover answer direction.
do $$
declare r record; seen_n integer; correct_n integer; wrong_n integer; seat record; q jsonb; offered integer;
begin
  perform pg_advisory_xact_lock(732028);
  if exists(select 1 from gsb_settings where key='face-history-v1') then return; end if;
  lock table gsb_face_totals in share row exclusive mode;
  lock table gsb_progress in share row exclusive mode;
  for r in
    with memories as (
      select p.* from gsb_progress p where direction='both' or not exists(
        select 1 from gsb_progress b where b.account_id=p.account_id and b.person_id=p.person_id and b.direction='both')),
    lifetime as (select account_id,person_id,sum((doc->>'reviews')::int)::int as reviews,
      sum((doc->>'correct')::int)::int as correct,max((doc->>'lastAt')::bigint) as last_at
      from memories group by account_id,person_id)
    select l.*,coalesce(t.seen,0)::int as recorded_seen,coalesce(t.correct,0)::int as recorded_correct,coalesce(t.wrong,0)::int as recorded_wrong
    from lifetime l left join (select account_id,person_id,sum(seen) as seen,sum(correct) as correct,sum(wrong) as wrong
      from gsb_face_totals where mode='practice' group by account_id,person_id) t using(account_id,person_id)
    order by l.account_id,l.person_id
  loop
    correct_n=greatest(0,r.correct-r.recorded_correct);
    wrong_n=greatest(0,r.reviews-r.correct-r.recorded_wrong);
    seen_n=greatest(correct_n+wrong_n,r.reviews-r.recorded_seen);
    if seen_n>0 then
      perform gsb_observe(r.account_id,'legacy-practice',r.person_id,r.person_id,'practice','unknown',seen_n,correct_n,wrong_n,
        correct_n+wrong_n,wrong_n,coalesce(to_timestamp(r.last_at::double precision/1000),now()));
    end if;
  end loop;
  -- Completed older rooms retain their target sequence and progress, but not per-question answers.
  for r in select doc from rooms where doc->'game'->>'kitId'='recognition' and doc->>'phase'='over'
    and not coalesce((doc->'s'->>'void')::boolean,false) and doc->'s'->'_seen' is null
  loop
    for seat in select key,value from jsonb_each(r.doc->'s'->'players') order by key loop
      if not exists(select 1 from gsb_accounts where id=seat.key) then continue; end if;
      offered=least(jsonb_array_length(r.doc->'s'->'_order'),1+case when r.doc->'s'->>'mode'='race'
        then (seat.value->>'index')::int else (r.doc->'s'->>'index')::int end);
      for q in select value from jsonb_array_elements(r.doc->'s'->'_order') with ordinality where ordinality<=offered order by value->>'target' loop
        perform gsb_observe(seat.key,'room:'||(r.doc->'s'->>'$seed'),q->>'id',q->>'target',r.doc->'s'->>'mode',q->>'direction',1,0,0,0,0,
          coalesce(to_timestamp((r.doc->>'updatedAt')::double precision/1000),now()));
      end loop;
    end loop;
  end loop;
  update gsb_sprint_runs set result=result where result is not null;
  update gsb_guest_runs set claimed_account_id=claimed_account_id where claimed_account_id is not null;
  insert into gsb_settings(key,value) values('face-history-v1','true'::jsonb);
end $$;
