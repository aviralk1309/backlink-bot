import { NAV_ITEMS } from "./nav";

/**
 * A nav item shows when the user holds at least one of its permissions.
 * Hiding a link is a courtesy, not security: each page and action checks
 * again, and the database enforces the real rules.
 */
const REQUIRED: Record<string, readonly string[]> = {
  "/jobs": ["jobs.view"],
  "/reports": ["reports.view"],
  "/admin": ["users.manage", "roles.manage"],
};

export function visibleNavItems(permissions: readonly string[]) {
  return NAV_ITEMS.filter((item) =>
    // Unknown hrefs have no entry, so they stay hidden (fail closed).
    (REQUIRED[item.href] ?? []).some((p) => permissions.includes(p)),
  );
}
