const NOTICES: Record<string, string> = {
  created: "Role created.",
  updated: "Role saved.",
  deleted: "Role deleted.",
};

/** Turns the `?saved=` flag set by the role actions into a status line. */
export function savedNotice(raw: string | undefined): string | null {
  if (!raw || !Object.hasOwn(NOTICES, raw)) return null;
  return NOTICES[raw] ?? null;
}
