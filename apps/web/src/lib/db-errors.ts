/**
 * Maps the database's stable error codes (raised by triggers and functions
 * in supabase/migrations) to plain language. Matching is by substring
 * because PostgREST wraps the code inside a longer message.
 */
const DB_ERRORS: Record<string, string> = {
  lockout_last_admin: "There must always be at least one active Admin.",
  lockout_protected_role:
    "The Admin role is protected and cannot be changed this way.",
  lockout_role_in_use:
    "That role still has users. Move them to another role first.",
  lockout_admin_permission:
    "The Admin role must keep user and role management.",
  roles_name_lower_key: "A role with that name already exists.",
  invalid_permission:
    "One of the permissions is not recognized. Reload and try again.",
  role_not_found: "That role no longer exists. Reload the page.",
  // Jobs (M2)
  job_not_ready:
    "This job is not ready to start yet. Open the job to see what is missing.",
  invalid_transition:
    "That action is not available for the job's current status. Reload the page.",
  invalid_action: "That action is not valid.",
  job_not_found: "That job no longer exists. Reload the page.",
  activity_profiles_key_key: "An activity with that key already exists.",
  blocklist_domain_key: "That domain is already on the blocklist.",
  forbidden: "You do not have permission to do that.",
};

const FALLBACK = "Could not save the change. Try again.";

export function describeDbError(message: string): string {
  for (const [code, text] of Object.entries(DB_ERRORS)) {
    if (message.includes(code)) return text;
  }
  return FALLBACK;
}
