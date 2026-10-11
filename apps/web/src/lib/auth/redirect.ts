/**
 * Accepts only same-origin relative paths. Anything else (absolute URLs,
 * protocol-relative "//host", backslash tricks, control characters) falls
 * back, so `?next=` can never become an open redirect.
 */
export function safeNext(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  for (const ch of raw) {
    if (ch.charCodeAt(0) < 32) return fallback;
  }
  return raw;
}
