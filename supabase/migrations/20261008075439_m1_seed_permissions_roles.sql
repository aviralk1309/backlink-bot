-- M1-S2: permission catalog and starter roles.
-- Catalog grows only through new migrations. A migration that adds a
-- permission must also grant it to the Admin role.
-- Idempotent: safe to re-run.

insert into public.permissions (key, "group", description) values
  ('jobs.view',              'Jobs',    'See jobs and their settings'),
  ('jobs.create',            'Jobs',    'Create jobs'),
  ('jobs.edit',              'Jobs',    'Edit job settings'),
  ('jobs.delete',            'Jobs',    'Delete jobs'),
  ('jobs.start',             'Jobs',    'Start a job'),
  ('jobs.control',           'Jobs',    'Pause, resume and stop jobs'),
  ('jobs.rescore',           'Jobs',    'Re-apply current scoring weights to stored checks'),
  ('results.view',           'Results', 'See ready and backlog results'),
  ('results.view_filtered',  'Results', 'See auto-filtered results'),
  ('results.review',         'Results', 'Approve, reject and mark results as used'),
  ('results.export',         'Results', 'Export results to CSV'),
  ('results.release_batch',  'Results', 'Release the next batch from backlog'),
  ('csv.upload',             'Data',    'Upload competitor and client CSV files'),
  ('mapping_templates.manage','Data',   'Create and edit CSV mapping templates'),
  ('blocklist.manage',       'Data',    'Add and remove global blocklist domains'),
  ('activities.manage',      'Data',    'Manage activity profiles'),
  ('reports.view',           'Data',    'See feedback reports'),
  ('users.manage',           'Admin',   'Invite, approve, assign roles to and deactivate users'),
  ('roles.manage',           'Admin',   'Create, edit and delete roles and their permissions'),
  ('system.view_health',     'Admin',   'See worker and system health')
on conflict (key) do update
  set "group" = excluded."group",
      description = excluded.description;

-- Starter roles use fixed ids so scripts and tests can reference them.
insert into public.roles (id, name, description, is_system, is_protected) values
  ('a0000000-0000-0000-0000-000000000001', 'Admin',
   'Full access. Cannot be deleted or lose user and role management.', true, true),
  ('a0000000-0000-0000-0000-000000000002', 'Manager',
   'Reviews and verifies results, uploads CSVs, exports, manages the blocklist.', true, false),
  ('a0000000-0000-0000-0000-000000000003', 'Viewer',
   'Read-only access.', true, false)
on conflict (id) do nothing;

-- Admin: every permission in the catalog
insert into public.role_permissions (role_id, permission_key)
select 'a0000000-0000-0000-0000-000000000001'::uuid, key
from public.permissions
on conflict do nothing;

-- Manager (replaces the plan's "Product team"; blocklist.manage per M1-P2)
insert into public.role_permissions (role_id, permission_key)
select 'a0000000-0000-0000-0000-000000000002'::uuid, k
from unnest(array[
  'jobs.view',
  'results.view',
  'results.view_filtered',
  'results.review',
  'results.export',
  'results.release_batch',
  'csv.upload',
  'mapping_templates.manage',
  'blocklist.manage',
  'reports.view'
]) as k
on conflict do nothing;

-- Viewer
insert into public.role_permissions (role_id, permission_key)
select 'a0000000-0000-0000-0000-000000000003'::uuid, k
from unnest(array['jobs.view', 'results.view', 'reports.view']) as k
on conflict do nothing;