/**
 * Sections of the Admin area. A section shows when the user holds its
 * permission. Hiding a tab is a courtesy: each page checks again and the
 * database enforces the real rules.
 */
export const ADMIN_SECTIONS = [
  { label: "Users", href: "/admin/users", permission: "users.manage" },
  { label: "Roles", href: "/admin/roles", permission: "roles.manage" },
] as const;

export function visibleAdminSections(permissions: readonly string[]) {
  return ADMIN_SECTIONS.filter((s) => permissions.includes(s.permission));
}
