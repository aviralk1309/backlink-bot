import type { JobStatus } from "./types";

/** A9: the dashboard polls every few seconds. */
export const POLL_INTERVAL_MS = 5000;

/** Statuses where counters can still change. Others show final numbers. */
const POLLING_STATUSES: readonly JobStatus[] = [
  "queued",
  "running",
  "paused",
  "saturated",
];

export function isPollingStatus(status: JobStatus): boolean {
  return POLLING_STATUSES.includes(status);
}

// Fixed locale: server and browser must print the same text.
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

export function formatCount(n: number): string {
  return COUNT_FORMAT.format(Number.isFinite(n) ? n : 0);
}

/** Whole percent of the budget used, clamped to 0..100. 0 when there is no budget. */
export function creditPercent(used: number, budget: number): number {
  if (!(budget > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((used / budget) * 100)));
}
