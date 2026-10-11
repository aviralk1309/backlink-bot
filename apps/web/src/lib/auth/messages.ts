/** Reasons the middleware or confirm route can send a user back to /login. */
export const SIGNOUT_REASONS = [
  "pending",
  "rejected",
  "deactivated",
  "no_profile",
] as const;

export type SignoutReason = (typeof SIGNOUT_REASONS)[number];

export function isSignoutReason(value: string): value is SignoutReason {
  return (SIGNOUT_REASONS as readonly string[]).includes(value);
}

const LOGIN_NOTICES: Record<string, string> = {
  pending: "Your email is not approved by admin yet.",
  rejected: "Your sign-up request was not approved. Contact an admin.",
  deactivated: "This account has been deactivated. Contact an admin.",
  no_profile: "Account setup is incomplete. Contact an admin.",
  link_invalid: "That link is invalid or has expired. Request a new one.",
};

/** Safe lookup: query-string input must never hit Object.prototype keys. */
export function getLoginNotice(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return Object.hasOwn(LOGIN_NOTICES, key) ? LOGIN_NOTICES[key] : undefined;
}
