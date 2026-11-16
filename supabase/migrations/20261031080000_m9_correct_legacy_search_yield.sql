-- One-time correction for the Google navigation domain counted in old queries.
-- Keep the original value so an audit or rollback can reconstruct the prior yield.
alter table public.job_queries
  add column pre_redirect_new_unique_domains integer
    check (pre_redirect_new_unique_domains is null or pre_redirect_new_unique_domains >= 0);

with first_google_source as (
  select distinct on (o.job_id, o.domain)
    q.id as query_id, q.new_unique_domains, o.filter_reason
  from public.opportunities o
  join public.opportunity_sources s on s.opportunity_id = o.id
    and s.source_type = 'google'
  join public.job_queries q on q.id::text = s.source_ref
    and q.job_id = o.job_id
  join public.job_domains d on d.job_id = o.job_id
    and d.registered_domain = o.domain and d.first_source_type = 'google'
  where o.domain = 'google.com' and o.host = o.domain
    and q.accepted_result_count is null
  order by o.job_id, o.domain, s.found_at, q.priority, q.id
)
update public.job_queries q set
  pre_redirect_new_unique_domains = q.new_unique_domains,
  new_unique_domains = q.new_unique_domains - 1
from first_google_source f
where q.id = f.query_id and f.filter_reason = 'search_redirect'
  and q.new_unique_domains > 0
  and q.pre_redirect_new_unique_domains is null;
