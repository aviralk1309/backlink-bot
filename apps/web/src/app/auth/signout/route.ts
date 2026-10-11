import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSignoutReason } from "@/lib/auth/messages";

async function signOutAndRedirect(request: NextRequest, reason?: string) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL("/login", request.url);
  if (reason) url.searchParams.set("error", reason);
  return NextResponse.redirect(url, { status: 303 });
}

/** GET exists only for the middleware's "your account is not active" redirect. */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason");
  if (!reason || !isSignoutReason(reason)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return signOutAndRedirect(request, reason);
}

/** The logout button posts here. */
export async function POST(request: NextRequest) {
  return signOutAndRedirect(request);
}
