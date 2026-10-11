import {
  JOB_STATUSES,
  type ActivityOption,
  type JobAction,
  type JobStatus,
} from "./types";

// ---------------------------------------------------------------------
// Status and lifecycle (mirrors supabase/migrations/*_m2_job_lifecycle.sql)
// ---------------------------------------------------------------------

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  saturated: "Saturated",
  stopped: "Stopped",
};

const TERMINAL: readonly JobStatus[] = ["completed", "failed", "stopped"];

export const isTerminal = (status: JobStatus) => TERMINAL.includes(status);

/** Finished jobs keep their settings as a record. */
export const isEditable = (status: JobStatus) => !isTerminal(status);

/** Mirrors the jobs_delete RLS policy: workers may be touching these. */
export const isDeletable = (status: JobStatus) =>
  status !== "queued" && status !== "running";

const LEGAL_ACTIONS: Record<JobStatus, readonly JobAction[]> = {
  draft: ["start"],
  queued: ["stop"],
  running: ["pause", "stop"],
  paused: ["resume", "stop"],
  saturated: ["resume", "stop"],
  completed: [],
  failed: [],
  stopped: [],
};

const ACTION_PERMISSION: Record<JobAction, string> = {
  start: "jobs.start",
  pause: "jobs.control",
  resume: "jobs.control",
  stop: "jobs.control",
};

export const permissionForAction = (action: JobAction) =>
  ACTION_PERMISSION[action];

/** Actions the state machine allows from this status, ignoring who asks. */
export const legalActions = (status: JobStatus): readonly JobAction[] =>
  LEGAL_ACTIONS[status];

/** Legal actions the user also holds the permission for. Drives the buttons. */
export function availableActions(
  status: JobStatus,
  permissions: readonly string[],
): JobAction[] {
  return LEGAL_ACTIONS[status].filter((a) =>
    permissions.includes(ACTION_PERMISSION[a]),
  );
}

export type Plan = { ok: true } | { ok: false; error: string };

/**
 * Checks a start/pause/resume/stop request before it reaches the database.
 * The database enforces the same table; this gives a clear message and the
 * confirmation rule for resuming a Saturated job (gap G3).
 */
export function planTransition(input: {
  status: JobStatus;
  action: JobAction;
  confirm: boolean;
}): Plan {
  const { status, action, confirm } = input;
  if (!LEGAL_ACTIONS[status].includes(action)) {
    return {
      ok: false,
      error: `That action is not available while the job is ${JOB_STATUS_LABELS[status].toLowerCase()}.`,
    };
  }
  if (action === "resume" && status === "saturated" && !confirm) {
    return {
      ok: false,
      error:
        "This job stopped finding new domains. Confirm that you want to resume it.",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Start readiness (codes come from job_start_problems in SQL)
// ---------------------------------------------------------------------

export const START_PROBLEM_TEXT: Record<string, string> = {
  missing_client_domain: "Add the client's domain.",
  missing_business_type: "Add the business type.",
  missing_country: "Choose a country.",
  missing_language: "Choose a language.",
  missing_seed_keywords: "Add at least one seed keyword.",
  no_activity: "Choose at least one activity.",
  activity_unknown: "One of the selected activities no longer exists.",
  activity_disabled: "One of the selected activities is disabled.",
  no_source:
    "Add a source: a Serper credit budget above 0, seed list URLs or competitor domains.",
};

export function startProblemText(code: string): string {
  return START_PROBLEM_TEXT[code] ?? code;
}

/** Pulls the codes out of a `job_not_ready:a,b,c` database error. */
export function parseStartProblems(message: string): string[] {
  const match = /job_not_ready:([a-z_,]+)/.exec(message);
  const list = match?.[1];
  return list ? list.split(",").filter(Boolean) : [];
}

export function describeStartProblems(codes: readonly string[]): string {
  if (codes.length === 0) return "This job cannot start yet.";
  return `This job cannot start yet. ${codes.map(startProblemText).join(" ")}`;
}

// ---------------------------------------------------------------------
// Saving a job
// ---------------------------------------------------------------------

/**
 * Activity keys must exist, and a disabled activity can only stay on a job
 * that already had it (so disabling an activity never blocks edits).
 */
export function planJobSave(input: {
  /** null when creating. */
  previousActivityKeys: readonly string[] | null;
  activityKeys: readonly string[];
  activities: readonly ActivityOption[];
}): Plan {
  const byKey = new Map(input.activities.map((a) => [a.key, a]));
  const previous = new Set(input.previousActivityKeys ?? []);
  for (const key of input.activityKeys) {
    const activity = byKey.get(key);
    if (!activity) {
      return {
        ok: false,
        error:
          "One of the selected activities no longer exists. Reload the page and try again.",
      };
    }
    if (!activity.enabled && !previous.has(key)) {
      return {
        ok: false,
        error: `The “${activity.name}” activity is disabled. Ask an admin to enable it.`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------
// Cleaning user input (chips, domains, URLs)
// ---------------------------------------------------------------------

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function preview(s: string): string {
  const c = collapse(s);
  return c.length > 40 ? `${c.slice(0, 40)}…` : c;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
// Dotted labels, then a TLD that starts with a letter. Rejects "localhost",
// IP addresses and anything with underscores or spaces. Stricter than the
// blocklist_domain_format check in the database, so anything passing here
// passes there.
const DOMAIN_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$`);

/**
 * "https://www.Example.com:8080/a?b#c" -> "example.com". Returns null when
 * the input is not a usable registered-looking domain. Unicode domains
 * become punycode.
 */
export function normalizeDomain(input: string): string | null {
  const raw = collapse(input);
  if (!raw || raw.includes(" ")) return null;

  let host: string;
  try {
    const url = new URL(SCHEME.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    host = url.hostname;
  } catch {
    return null;
  }

  host = host.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("www.") && host.slice(4).includes(".")) {
    host = host.slice(4);
  }
  if (host.length > 253) return null;
  return DOMAIN_RE.test(host) ? host : null;
}

/**
 * A tidy http(s) URL: scheme added when missing, fragment removed, host
 * lowercased, bare-root trailing slash dropped. Rejects credentials, IPs and
 * single-label hosts (the worker never fetches those). Full URL
 * normalization for duplicate detection is the M3 normalizer's job.
 */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw) || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.replace(/\.$/, "");
  if (host.length > 253 || !DOMAIN_RE.test(host)) return null;

  url.hash = "";
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

export type ListResult =
  { ok: true; values: string[] } | { ok: false; error: string };

type ListOptions = { label: string; max: number };

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function limit(values: string[], o: ListOptions): ListResult {
  return values.length > o.max
    ? { ok: false, error: `${o.label}: too many entries (${o.max} at most).` }
    : { ok: true, values };
}

/** Free-text chips: spaces collapsed, blanks dropped, duplicates removed. */
export function cleanTextList(
  raw: readonly string[],
  o: ListOptions & { maxLen: number; lower?: boolean },
): ListResult {
  const values: string[] = [];
  for (const item of raw) {
    const c = collapse(item);
    if (!c) continue;
    if (c.length > o.maxLen) {
      return {
        ok: false,
        error: `${o.label}: “${preview(c)}” is too long (${o.maxLen} characters max).`,
      };
    }
    values.push(o.lower ? c.toLowerCase() : c);
  }
  return limit(dedupe(values), o);
}

export function cleanDomainList(
  raw: readonly string[],
  o: ListOptions,
): ListResult {
  const values: string[] = [];
  for (const item of raw) {
    if (!collapse(item)) continue;
    const d = normalizeDomain(item);
    if (!d) {
      return {
        ok: false,
        error: `${o.label}: “${preview(item)}” is not a valid domain.`,
      };
    }
    values.push(d);
  }
  return limit(dedupe(values), o);
}

export function cleanUrlList(
  raw: readonly string[],
  o: ListOptions,
): ListResult {
  const values: string[] = [];
  for (const item of raw) {
    if (!collapse(item)) continue;
    const u = normalizeUrl(item);
    if (!u) {
      return {
        ok: false,
        error: `${o.label}: “${preview(item)}” is not a valid web address.`,
      };
    }
    values.push(u);
  }
  return limit(dedupe(values), o);
}

// ---------------------------------------------------------------------
// Jobs list filters
// ---------------------------------------------------------------------

export const PAGE_SIZE = 25;

/**
 * Search text goes into a PostgREST filter string, so characters that have
 * meaning there (and LIKE wildcards) are removed instead of escaped.
 */
export function sanitizeSearch(q: string): string {
  return collapse(q.replace(/[%_*,()"'\\]/g, " ")).slice(0, 100);
}

export type JobListParams = {
  status: JobStatus | null;
  q: string;
  page: number;
};

export function parseListParams(raw: {
  status?: string;
  q?: string;
  page?: string;
}): JobListParams {
  const status = JOB_STATUSES.find((s) => s === raw.status) ?? null;
  const n = Number.parseInt(raw.page ?? "1", 10);
  const page = Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
  return { status, q: sanitizeSearch(raw.q ?? ""), page };
}
