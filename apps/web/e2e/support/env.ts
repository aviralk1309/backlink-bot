import { createClient } from "@supabase/supabase-js";

/** Playwright does not load Next's env files, so read them here. */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // File missing is fine: the variables may come from the shell.
    }
  }
}

function need(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`e2e needs ${name} (apps/web/.env.local).`);
  }
  return value;
}

/** Refuses anything but a local Supabase: setup creates users and deletes roles. */
function localUrl(): string {
  loadEnvFiles();
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `Refusing to run e2e against ${host}. Point .env.local at local Supabase.`,
    );
  }
  return url;
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
};

/** Service-role client for test setup and for checking what really changed. */
export function e2eAdminClient() {
  const url = localUrl();
  return createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), clientOptions);
}

/** Anon-key client, the same one the browser uses. RLS applies to it. */
export function e2eAnonClient() {
  const url = localUrl();
  return createClient(
    url,
    need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    clientOptions,
  );
}