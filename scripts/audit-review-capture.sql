-- Run with: psql "$AUDIT_DATABASE_URL" -X -f scripts/audit-review-capture.sql
-- Requires a role that can see every opportunity and review history row.
\set ON_ERROR_STOP on
begin read only;
set local row_security = off;

do $audit$
declare
  v_issue record;
  v_decided bigint;
  v_failures bigint := 0;
begin
  select count(*) into v_decided from public.opportunities
    where review_status in ('approved', 'rejected', 'used');

  for v_issue in
    with decided as (
      select o.id, o.review_status, o.score_at_review, o.reject_reason,
        o.reject_scope, h.id as history_id, h.score as history_score,
        h.scoring_inputs as history_inputs,
        h.reject_reason as history_reason, h.reject_scope as history_scope
      from public.opportunities o
      left join lateral (
        select r.id, r.score, r.scoring_inputs, r.reject_reason, r.reject_scope
        from public.opportunity_reviews r
        where r.opportunity_id = o.id and r.at = o.reviewed_at
          and r.to_status = o.review_status
          and r.from_status <> r.to_status
        order by r.id desc limit 1
      ) h on true
      where o.review_status in ('approved', 'rejected', 'used')
    ), issues as (
      select d.id, x.issue from decided d
      cross join lateral (values
        ('missing_decision_history', d.history_id is null),
        ('missing_score_at_review', d.score_at_review is null),
        ('missing_decision_scoring_inputs', d.history_id is not null
          and d.history_inputs is null),
        ('missing_reject_reason', d.review_status = 'rejected' and d.reject_reason is null),
        ('missing_reject_scope', d.review_status = 'rejected' and d.reject_scope is null),
        ('score_snapshot_mismatch', d.history_id is not null
          and d.score_at_review is distinct from d.history_score),
        ('reject_snapshot_mismatch', d.history_id is not null
          and d.review_status = 'rejected'
          and (d.reject_reason is distinct from d.history_reason
            or d.reject_scope is distinct from d.history_scope))
      ) x(issue, bad)
      where x.bad
    )
    select issue, count(*) as issue_count, min(id::text) as example_id
      from issues group by issue order by issue
  loop
    raise notice '%: % row(s); example opportunity %',
      v_issue.issue, v_issue.issue_count, v_issue.example_id;
    v_failures := v_failures + v_issue.issue_count;
  end loop;

  if v_failures > 0 then
    raise exception 'review capture audit failed: % issue(s) across % decided rows',
      v_failures, v_decided;
  end if;
  raise notice 'review capture audit passed: % decided rows checked', v_decided;
end;
$audit$;

commit;
