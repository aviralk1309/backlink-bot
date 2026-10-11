-- M2-S8 (seed part): starter activity profiles, guest_post and resource_page.
--
-- Why a migration and not seed.sql: seed.sql runs only on a local reset.
-- The job form needs at least one activity in every environment, so the
-- starter rows ship with the schema. `on conflict do nothing` means admin
-- edits made later in the dashboard are never overwritten.
--
-- PLACEHOLDER CONTENT. Real quality depends on product input (M2-PM1):
-- footprint templates per language, page-type signals, reviewer fields.
-- Admins refine these in the dashboard (Admin > Activities), no deploy.
--
-- jsonb contract (the web editors in Step 7 and the worker in M5/M8 rely
-- on these shapes):
--
--  footprint_templates  array of
--    { id, template, language ("*" or ISO 639-1), priority (1 = first), enabled }
--    placeholders: {keyword} {niche} {brand} {country} {city}
--  page_type_signals    object
--    { url_patterns[], title_phrases[], heading_phrases[], body_phrases[],
--      structure: { link_list: bool, min_outbound_links: int } }
--  relevance_rule       object
--    { field_weights: { title, headings, meta, body }, min_score (0..1) }
--  scoring_weights      object, positive parts sum to 100, spam is a cap
--    { relevance, language_region, activity_fit, overlap, multi_query,
--      spam_penalty }
--  reviewer_fields      array of { key, label, type: text | number | url }

insert into public.activity_profiles (
  key, name, enabled, footprint_templates, page_type_signals,
  relevance_rule, scoring_weights, per_domain_cap, reviewer_fields
) values
(
  'guest_post',
  'Guest post',
  true,
  $json$[
    {"id": "gp_write_for_us",   "template": "\"write for us\" {keyword}",              "language": "*", "priority": 1, "enabled": true},
    {"id": "gp_guest_post",     "template": "{keyword} \"guest post\"",                "language": "*", "priority": 2, "enabled": true},
    {"id": "gp_intitle_wfu",    "template": "intitle:\"write for us\" {niche}",        "language": "*", "priority": 3, "enabled": true},
    {"id": "gp_submit",         "template": "{keyword} \"submit a guest post\"",       "language": "*", "priority": 4, "enabled": true},
    {"id": "gp_inurl_wfu",      "template": "{keyword} inurl:write-for-us",            "language": "*", "priority": 5, "enabled": true},
    {"id": "gp_contributor",    "template": "{keyword} \"become a contributor\"",      "language": "*", "priority": 6, "enabled": true}
  ]$json$::jsonb,
  $json${
    "url_patterns": ["write-for-us", "guest-post", "contribute", "submit-post", "become-a-contributor"],
    "title_phrases": ["write for us", "guest post", "become a contributor", "contribute"],
    "heading_phrases": ["write for us", "guest post guidelines", "submit a guest post"],
    "body_phrases": ["guest post", "submission guidelines", "contributor"],
    "structure": {"link_list": false, "min_outbound_links": 0}
  }$json$::jsonb,
  $json${
    "field_weights": {"title": 3, "headings": 2, "meta": 2, "body": 1},
    "min_score": 0.2
  }$json$::jsonb,
  $json${
    "relevance": 35,
    "language_region": 10,
    "activity_fit": 20,
    "overlap": 20,
    "multi_query": 15,
    "spam_penalty": 30
  }$json$::jsonb,
  3,
  $json$[
    {"key": "dr",            "label": "Domain rating",   "type": "number"},
    {"key": "traffic",       "label": "Monthly traffic", "type": "number"},
    {"key": "contact_email", "label": "Contact email",   "type": "text"},
    {"key": "guidelines_url","label": "Guidelines page", "type": "url"}
  ]$json$::jsonb
),
(
  'resource_page',
  'Resource page',
  true,
  $json$[
    {"id": "rp_useful_links",   "template": "{keyword} \"useful links\"",              "language": "*", "priority": 1, "enabled": true},
    {"id": "rp_intitle_res",    "template": "intitle:resources {keyword}",             "language": "*", "priority": 2, "enabled": true},
    {"id": "rp_inurl_res",      "template": "{keyword} inurl:resources",               "language": "*", "priority": 3, "enabled": true},
    {"id": "rp_helpful",        "template": "{keyword} \"helpful resources\"",         "language": "*", "priority": 4, "enabled": true},
    {"id": "rp_intitle_links",  "template": "intitle:\"useful links\" {niche}",        "language": "*", "priority": 5, "enabled": true},
    {"id": "rp_inurl_links",    "template": "{keyword} inurl:links",                   "language": "*", "priority": 6, "enabled": true}
  ]$json$::jsonb,
  $json${
    "url_patterns": ["resources", "useful-links", "links", "recommended"],
    "title_phrases": ["resources", "useful links", "helpful links", "recommended"],
    "heading_phrases": ["useful links", "helpful resources", "further reading"],
    "body_phrases": ["useful links", "resources", "recommended reading"],
    "structure": {"link_list": true, "min_outbound_links": 10}
  }$json$::jsonb,
  $json${
    "field_weights": {"title": 3, "headings": 2, "meta": 2, "body": 1},
    "min_score": 0.2
  }$json$::jsonb,
  $json${
    "relevance": 35,
    "language_region": 10,
    "activity_fit": 25,
    "overlap": 20,
    "multi_query": 10,
    "spam_penalty": 30
  }$json$::jsonb,
  3,
  $json$[
    {"key": "dr",            "label": "Domain rating",   "type": "number"},
    {"key": "traffic",       "label": "Monthly traffic", "type": "number"},
    {"key": "contact_email", "label": "Contact email",   "type": "text"},
    {"key": "list_page_url", "label": "Resource list URL","type": "url"}
  ]$json$::jsonb
)
on conflict (key) do nothing;