// Pure helpers for scripts/bootstrap-admin.mjs. No I/O, so they are unit-tested.

// Fixed id from supabase/migrations/..._m1_seed_permissions_roles.sql.
export const ADMIN_ROLE_ID = "a0000000-0000-0000-0000-000000000001";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (error) => ({ ok: false, error });
const trimSlash = (url) => url.trim().replace(/\/+$/, "");

function argValue(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

/** Same rules as newPassword in src/lib/auth/schemas.ts. */
function passwordProblem(password) {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one digit.";
  return null;
}

/**
 * Turns env vars and CLI args into validated input, or an error message.
 * The service key is checked here but never returned.
 */
export function parseBootstrapInput({ env, args }) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return fail("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
  const target = trimSlash(supabaseUrl);

  const confirmUrl = argValue(args, "--confirm-url");
  if (!confirmUrl) {
    return fail(
      `Add --confirm-url ${target} to confirm which database this changes.`,
    );
  }
  if (trimSlash(confirmUrl) !== target) {
    return fail(
      `--confirm-url does not match NEXT_PUBLIC_SUPABASE_URL (${target}). Nothing was changed.`,
    );
  }

  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return fail("BOOTSTRAP_ADMIN_EMAIL is not set.");
  if (!EMAIL.test(email)) {
    return fail("BOOTSTRAP_ADMIN_EMAIL is not a valid email address.");
  }

  const name = env.BOOTSTRAP_ADMIN_NAME?.trim() || "Admin";
  if (name.length < 2 || name.length > 100) {
    return fail("BOOTSTRAP_ADMIN_NAME must be 2 to 100 characters.");
  }

  const password = env.BOOTSTRAP_ADMIN_PASSWORD || null;
  if (password) {
    const problem = passwordProblem(password);
    if (problem) return fail(`BOOTSTRAP_ADMIN_PASSWORD: ${problem}`);
  }

  const appUrl = trimSlash(
    env.BOOTSTRAP_APP_URL?.trim() || "http://localhost:3000",
  );

  return {
    ok: true,
    value: { email, name, password, supabaseUrl: target, appUrl },
  };
}

/**
 * What the script must do for the profile it found (null = no such user).
 * noop makes a second run change nothing.
 */
export function planBootstrap(profile, adminRoleId = ADMIN_ROLE_ID) {
  if (!profile) return { action: "create" };
  if (profile.status === "active" && profile.role_id === adminRoleId) {
    return { action: "noop" };
  }
  return {
    action: "promote",
    from: { status: profile.status, role_id: profile.role_id },
  };
}