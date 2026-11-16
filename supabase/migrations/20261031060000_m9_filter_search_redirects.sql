-- Search-engine navigation URLs are not backlink prospects. Preserve every
-- original row and its checks; save the previous presentation state in extras
-- so this one-time reclassification can be reversed without a database backup.
update public.opportunities o set
  extras = o.extras || jsonb_build_object('search_redirect_previous_state', jsonb_build_object(
    'queue_group', o.queue_group,
    'check_status', o.check_status,
    'check_reason', o.check_reason,
    'filter_reason', o.filter_reason,
    'filter_detail', o.filter_detail,
    'tier', o.tier,
    'score', o.score,
    'score_breakdown', o.score_breakdown
  )),
  queue_group = 'auto_filtered',
  check_status = 'skipped',
  check_reason = 'search_redirect',
  filter_reason = 'search_redirect',
  filter_detail = 'Google search redirect, not a backlink prospect.',
  tier = null,
  score = null,
  score_breakdown = null
where o.first_source_type = 'google'
  and o.domain = 'google.com'
  and o.host = 'google.com'
  and split_part(o.normalized_url, '?', 1) in (
    'https://google.com/goto',
    'https://google.com/url',
    'https://google.com/aclk',
    'https://google.com/search'
  )
  and o.review_status = 'new'
  and o.duplicate_of is null
  and o.queue_group in ('ready', 'backlog')
  and not (o.extras ? 'search_redirect_previous_state');
