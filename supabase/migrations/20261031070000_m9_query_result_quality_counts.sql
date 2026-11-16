-- Keep provider result volume separate from usable URLs and repeated discoveries.
-- Old query rows stay null: their skipped malformed URLs were not recorded.
alter table public.job_queries
  add column accepted_result_count integer,
  add column rejected_result_count integer,
  add column duplicate_result_count integer,
  add constraint job_queries_quality_counts_valid check (
    (accepted_result_count is null and rejected_result_count is null
      and duplicate_result_count is null)
    or (accepted_result_count >= 0 and rejected_result_count >= 0
      and duplicate_result_count between 0 and accepted_result_count
      and result_count = accepted_result_count + rejected_result_count)
  );

grant update (accepted_result_count, rejected_result_count, duplicate_result_count)
  on public.job_queries to worker;
