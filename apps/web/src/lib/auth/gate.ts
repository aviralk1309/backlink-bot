export type ProfileStatus = "pending" | "active" | "rejected" | "deactivated";

export type AccessState =
  | { kind: "anonymous" }
  | { kind: "no_profile" }
  | { kind: "profile"; status: ProfileStatus };

export type GateDecision =
  { action: "allow" } | { action: "redirect"; to: string };

/** Only for signed-out visitors; signed-in active users are sent home. */
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];
/** Reachable by anyone, signed in or not (confirm links, sign-out, health). */
const ALWAYS_PUBLIC = ["/auth", "/api/health"];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Pure routing rule used by the middleware. Anything not listed above is
 * protected. A signed-in user whose profile is not `active` is always sent
 * through /auth/signout, which clears the session and explains why.
 */
export function decideAccess(
  pathname: string,
  state: AccessState,
  search = "",
): GateDecision {
  if (ALWAYS_PUBLIC.some((p) => matches(pathname, p))) {
    return { action: "allow" };
  }
  const guestOnly = GUEST_ONLY.some((p) => matches(pathname, p));

  switch (state.kind) {
    case "anonymous": {
      if (guestOnly) return { action: "allow" };
      const target = `${pathname}${search}`;
      const next = target === "/" ? "" : `?next=${encodeURIComponent(target)}`;
      return { action: "redirect", to: `/login${next}` };
    }
    case "no_profile":
      return { action: "redirect", to: "/auth/signout?reason=no_profile" };
    case "profile": {
      if (state.status !== "active") {
        return {
          action: "redirect",
          to: `/auth/signout?reason=${state.status}`,
        };
      }
      return guestOnly ? { action: "redirect", to: "/" } : { action: "allow" };
    }
  }
}
