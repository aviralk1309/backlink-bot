begin;
select plan(8);

-- Starter activity profiles ship with the migrations (every environment).

select is(
  (select count(*)::int from public.activity_profiles
    where key in ('guest_post', 'resource_page') and enabled),
  2,
  'guest_post and resource_page exist and are enabled'
);

select is(
  (select count(*)::int from public.activity_profiles
    where key in ('guest_post', 'resource_page')
      and jsonb_array_length(footprint_templates) >= 1),
  2,
  'both starter profiles have footprint templates'
);

select is(
  (select count(*)::int
     from public.activity_profiles a,
          jsonb_array_elements(a.footprint_templates) t
    where a.key in ('guest_post', 'resource_page')
      and not (t ? 'id' and t ? 'template' and t ? 'language'
               and t ? 'priority' and t ? 'enabled')),
  0,
  'every template has id, template, language, priority and enabled'
);

select is(
  (select count(*)::int from (
     select a.key, t ->> 'id' as id
       from public.activity_profiles a,
            jsonb_array_elements(a.footprint_templates) t
      where a.key in ('guest_post', 'resource_page')
      group by 1, 2 having count(*) > 1) d),
  0,
  'template ids are unique inside a profile'
);

select is(
  (select count(*)::int from public.activity_profiles a
    where a.key in ('guest_post', 'resource_page')
      and (select sum(w.value::numeric)
             from jsonb_each_text(a.scoring_weights) as w
            where w.key <> 'spam_penalty') = 100),
  2,
  'positive scoring weights sum to 100'
);

select is(
  (select count(*)::int from public.activity_profiles
    where key in ('guest_post', 'resource_page') and per_domain_cap = 3),
  2,
  'per-domain cap defaults to 3 (M2-P4)'
);

select is(
  (select count(*)::int from public.activity_profiles
    where key in ('guest_post', 'resource_page') and version = 1),
  2,
  'starter profiles start at version 1'
);

select is(
  (select (page_type_signals -> 'structure' ->> 'link_list')::boolean
     from public.activity_profiles where key = 'resource_page'),
  true,
  'resource_page expects a link-list structure'
);

select * from finish();
rollback;