/** M3-S9: which workers count as online. Pure, so it is testable. */

/** Matches the worker's default HEARTBEAT_SECONDS (15) times 3. */
export const WORKER_STALE_MS = 45_000;

/** The badge polls slower than jobs: worker state changes rarely. */
export const WORKER_POLL_MS = 15_000;

export type WorkerBeat = { worker_id: string; last_seen_at: string };

export type WorkerStatus = {
  /** Heartbeats fresher than WORKER_STALE_MS. */
  online: number;
  /** Every heartbeat row. A crashed worker leaves a stale row behind. */
  known: number;
  newest_seen_at: string | null;
};

export function classifyWorkers(
  beats: readonly WorkerBeat[],
  nowMs: number,
): WorkerStatus {
  let online = 0;
  let newest: number | null = null;
  for (const beat of beats) {
    const seen = Date.parse(beat.last_seen_at);
    // An unreadable timestamp counts as stale, never as online.
    if (Number.isNaN(seen)) continue;
    if (nowMs - seen <= WORKER_STALE_MS) online += 1;
    if (newest === null || seen > newest) newest = seen;
  }
  return {
    online,
    known: beats.length,
    newest_seen_at: newest === null ? null : new Date(newest).toISOString(),
  };
}
