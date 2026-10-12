export type Crumb = { label: string; href: string };

const LABELS: Record<string, string> = {
  admin: "Admin",
  users: "Users",
  roles: "Roles",
  activities: "Activities",
  blocklist: "Blocklist",
  new: "New",
  edit: "Edit",
  jobs: "Jobs",
  reports: "Reports",
};

/** Home plus one crumb per path segment. Unknown segments (ids) read "Details". */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Home", href: "/" }];
  let href = "";
  for (const segment of pathname.split("/").filter(Boolean)) {
    href += `/${segment}`;
    crumbs.push({ label: LABELS[segment] ?? "Details", href });
  }
  return crumbs;
}
