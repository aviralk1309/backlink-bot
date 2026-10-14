import { describe, expect, it } from "vitest";
import { classifyWorkers, WORKER_STALE_MS } from "./workers";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("classifyWorkers", () => {
  it("reports no workers for an empty table", () => {
    expect(classifyWorkers([], NOW)).toEqual({
      online: 0,
      known: 0,
      newest_seen_at: null,
    });
  });

  it("counts a fresh heartbeat as online", () => {
    const s = classifyWorkers(
      [{ worker_id: "a", last_seen_at: ago(5_000) }],
      NOW,
    );
    expect(s.online).toBe(1);
    expect(s.known).toBe(1);
  });

  it("counts exactly the stale limit as online, one millisecond more as offline", () => {
    const edge = classifyWorkers(
      [{ worker_id: "a", last_seen_at: ago(WORKER_STALE_MS) }],
      NOW,
    );
    const past = classifyWorkers(
      [{ worker_id: "a", last_seen_at: ago(WORKER_STALE_MS + 1) }],
      NOW,
    );
    expect(edge.online).toBe(1);
    expect(past.online).toBe(0);
  });

  it("keeps a crashed worker's old row in known but not in online", () => {
    const s = classifyWorkers(
      [
        { worker_id: "live", last_seen_at: ago(1_000) },
        { worker_id: "crashed", last_seen_at: ago(10 * 60_000) },
      ],
      NOW,
    );
    expect(s.online).toBe(1);
    expect(s.known).toBe(2);
    expect(s.newest_seen_at).toBe(ago(1_000));
  });

  it("never counts an unreadable timestamp as online", () => {
    const s = classifyWorkers(
      [{ worker_id: "a", last_seen_at: "garbage" }],
      NOW,
    );
    expect(s.online).toBe(0);
    expect(s.known).toBe(1);
    expect(s.newest_seen_at).toBeNull();
  });
});
