export const REJECT_REASONS = {
  spam: "Spam",
  off_topic: "Off topic",
  no_link_option: "No link option",
  already_have: "Already have a link",
  other: "Other",
} as const;

export type ReviewIntent = "claim" | "approve" | "reject" | "used" | "reopen";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROW = new RegExp(`^(${UUID}):([0-9]+)$`, "i");

export function reviewRows(formData: FormData):
  | {
      rows: { id: string; version: number }[];
      intent: ReviewIntent;
      reason: keyof typeof REJECT_REASONS | null;
      note: string | null;
    }
  | { error: string } {
  const intent = formData.get("intent");
  if (
    typeof intent !== "string" ||
    !["claim", "approve", "reject", "used", "reopen"].includes(intent)
  )
    return { error: "Choose a review action." };
  const rawRows = formData.getAll("row");
  if (
    rawRows.length < 1 ||
    rawRows.length > 50 ||
    (rawRows.length > 1 && !["approve", "reject"].includes(intent))
  )
    return { error: "Select between 1 and 50 eligible results." };
  const rows: { id: string; version: number }[] = [];
  const seen = new Set<string>();
  for (const raw of rawRows) {
    const match = typeof raw === "string" ? ROW.exec(raw) : null;
    const version = match ? Number(match[2]) : NaN;
    if (
      !match ||
      !Number.isSafeInteger(version) ||
      seen.has(match[1]!.toLowerCase())
    )
      return { error: "Invalid result selection. Reload and try again." };
    seen.add(match[1]!.toLowerCase());
    rows.push({ id: match[1]!, version });
  }
  const reason = formData.get("reason");
  const note = formData.get("note");
  if (intent === "reject") {
    if (
      typeof reason !== "string" ||
      !Object.hasOwn(REJECT_REASONS, reason) ||
      typeof note !== "string" ||
      note.length > 4000 ||
      (reason === "other" && !note.trim())
    )
      return { error: "Choose a reject reason; Other also needs a note." };
    return {
      rows,
      intent,
      reason: reason as keyof typeof REJECT_REASONS,
      note: note.trim() || null,
    };
  }
  if (reason !== null || note !== null)
    return { error: "Invalid review details. Reload and try again." };
  return { rows, intent: intent as ReviewIntent, reason: null, note: null };
}
