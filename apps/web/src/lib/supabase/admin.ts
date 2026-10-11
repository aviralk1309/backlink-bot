import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";

/**
 * Service-role client. Bypasses RLS: use only inside server actions or route
 * handlers, and only after the caller's permission has been checked.
 */
export function createAdminClient() {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
