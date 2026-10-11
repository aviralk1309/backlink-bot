import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import {
  decideAccess,
  type AccessState,
  type ProfileStatus,
} from "@/lib/auth/gate";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() verifies the token with Supabase Auth; never trust getSession() here.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let state: AccessState = { kind: "anonymous" };
  if (user) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // Database trouble must not look like "no profile" and log people out.
      return new NextResponse("Service temporarily unavailable", {
        status: 503,
      });
    }
    state = profile
      ? { kind: "profile", status: profile.status as ProfileStatus }
      : { kind: "no_profile" };
  }

  const { pathname, search } = request.nextUrl;
  const decision = decideAccess(pathname, state, search);
  if (decision.action === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Keep any refreshed session cookies on the redirect response.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
