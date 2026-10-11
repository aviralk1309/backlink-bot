import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

/**
 * Landing point for invite and password-reset emails. The email carries a
 * hashed OTP that we exchange for a session here, then send the user to set
 * a password. Links are generated server-side and mailed by us.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"), "/set-password");

  if (tokenHash && (type === "recovery" || type === "invite")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(
    new URL("/login?error=link_invalid", request.url),
  );
}
