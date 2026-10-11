import type { JobAction } from "./types";

const SAVED: Record<string, string> = {
  created: "Job created.",
  updated: "Job saved.",
  deleted: "Job deleted.",
};

/** Turns the `?saved=` flag set by the job actions into a status line. */
export function savedNotice(raw: string | undefined): string | null {
  if (!raw || !Object.hasOwn(SAVED, raw)) return null;
  return SAVED[raw] ?? null;
}

/** Shown after a start, pause, resume or stop succeeds. */
export const TRANSITION_NOTICE: Record<JobAction, string> = {
  start: "Job started. It is queued until a worker picks it up.",
  pause: "Job paused.",
  resume: "Job resumed.",
  stop: "Job stopped. A stopped job cannot be restarted.",
};
