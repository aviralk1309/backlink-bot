const SAVED: Record<string, string> = {
  created: "Activity created.",
  updated: "Activity saved.",
};

/** Turns the `?saved=` flag set by the activity action into a status line. */
export function savedNotice(raw: string | undefined): string | null {
  if (!raw || !Object.hasOwn(SAVED, raw)) return null;
  return SAVED[raw] ?? null;
}
