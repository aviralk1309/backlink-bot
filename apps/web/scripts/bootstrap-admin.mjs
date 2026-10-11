#!/usr/bin/env node
// M1-S9: create or promote the first Admin. Safe to run twice.
//
//   pnpm bootstrap:admin --confirm-url <NEXT_PUBLIC_SUPABASE_URL>
//
// Reads BOOTSTRAP_ADMIN_EMAIL (required), BOOTSTRAP_ADMIN_NAME,
// BOOTSTRAP_ADMIN_PASSWORD and BOOTSTRAP_APP_URL from the shell or
// .env.local. Without a password it prints a one-time set-password link.
// Uses the service key: run it only from a trusted machine.
import { createClient } from "@supabase/supabase-js";
import {
  ADMIN_ROLE_ID,
  parseBootstrapInput,
  planBootstrap,
} from "./bootstrap-lib.mjs";

for (const file of [".env.local", ".env"]) {
  try {
    // Variables already set in the shell win over the file.
    process.loadEnvFile(file);
  } catch {
    // Missing file is fine.
  }
}

function die(message) {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

async function main() {
  const parsed = parseBootstrapInput({
    env: process.env,
    args: process.argv.slice(2),
  });
  if (!parsed.ok) die(parsed.error);
  const { email, name, password, supabaseUrl, appUrl } = parsed.value;

  const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Database: ${supabaseUrl}`);
  console.log(`Email:    ${email}`);

  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id, is_protected")
    .eq("id", ADMIN_ROLE_ID)
    .maybeSingle();
  if (roleError) die(`Could not read roles: ${roleError.message}`);
  if (!role?.is_protected) {
    die("The Admin role is missing. Run the migrations first (make db-reset).");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, status, role_id")
    .eq("email", email)
    .maybeSingle();
  if (profileError) die(`Could not read profiles: ${profileError.message}`);

  const plan = planBootstrap(profile);
  if (plan.action === "noop") {
    console.log("Already an active Admin. Nothing to do.");
    return;
  }

  let userId = profile?.id;
  let created = false;
  let setupLink = null;

  if (plan.action === "create") {
    if (password) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error || !data?.user) {
        die(`Could not create the user: ${error?.message ?? "unknown error"}`);
      }
      userId = data.user.id;
    } else {
      // Same pattern as inviteUserAction: the link creates the user.
      const { data, error } = await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: { data: { full_name: name } },
      });
      const hashed = data?.properties?.hashed_token;
      if (error || !data?.user || !hashed) {
        die(`Could not create the invite: ${error?.message ?? "unknown error"}`);
      }
      userId = data.user.id;
      setupLink = `${appUrl}/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=invite`;
    }
    created = true;
  }

  // The new-user trigger made a pending profile (or one already existed).
  const patch = { status: "active", role_id: ADMIN_ROLE_ID };
  if (!profile || profile.status !== "active") {
    patch.approved_at = new Date().toISOString();
  }
  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id");
  if (updateError || !updated?.length) {
    // Do not leave a half-made account behind.
    if (created) await admin.auth.admin.deleteUser(userId);
    die(`Could not make the user an Admin: ${updateError?.message ?? "no row updated"}`);
  }

  if (created) {
    console.log("Created the user and made them Admin.");
  } else {
    const was = `${plan.from.status}, role ${plan.from.role_id ?? "none"}`;
    console.log(`Existing user promoted to Admin (was: ${was}).`);
    console.log("Their password was not changed.");
  }

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role_id", ADMIN_ROLE_ID)
    .eq("status", "active");
  if (!countError) console.log(`Active Admins now: ${count}`);

  if (setupLink) {
    console.log("");
    console.log("One-time set-password link. Treat it like a password:");
    console.log(setupLink);
  }
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));