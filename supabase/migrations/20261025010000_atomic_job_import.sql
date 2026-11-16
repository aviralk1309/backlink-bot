-- B2: the runner owns pickup + gap + seed import in one transaction.
-- Do not import the gap here as well: that ran twice and escaped the import
-- savepoint. No data/shape/grant changes. Stop old workers before deploying
-- this migration and the matching runner (see ADR 0014).
create or replace function public.worker_pick_up_next_job()
returns table (job_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_problems text[];
begin
  select j.id
    into v_id
    from public.jobs j
   where j.status = 'queued'
   order by j.created_at, j.id
   limit 1
     for update skip locked;

  if v_id is null then
    return;
  end if;

  v_problems := public.job_start_problems(v_id);
  if cardinality(v_problems) > 0 then
    perform public.job_apply_transition(
      v_id, 'fail', 'bad_config:' || array_to_string(v_problems, ','), null
    );
    return query select v_id, 'failed'::text;
    return;
  end if;

  perform public.job_apply_transition(v_id, 'pick_up', null, null);
  return query select v_id, 'running'::text;
end;
$$;

comment on function public.worker_pick_up_next_job() is
  'Worker transaction primitive: caller MUST import gap and seeds in this same transaction before committing pickup. See ADR 0014.';
