"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  creditPercent,
  formatCount,
  isPollingStatus,
  POLL_INTERVAL_MS,
} from "./stats";
import type { JobLive, JobStats, JobStatus } from "./types";

type Props = {
  jobId: string;
  status: JobStatus;
  budget: number;
  initial: JobStats;
};

/**
 * Live counters. The server renders the first numbers, so there is no loading
 * state. While the job can still change, this polls every few seconds (A9).
 * When the job's status changes, it asks the page to re-render once, so the
 * header badge and action buttons follow. The page gives this component
 * key={status}, so it restarts with fresh numbers after that.
 */
export function LiveStats({ jobId, status, budget, initial }: Props) {
  const router = useRouter();
  const [stats, setStats] = useState<JobStats>(initial);
  const [failed, setFailed] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const polling = isPollingStatus(status);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function loop() {
      while (!cancelled) {
        let delay = POLL_INTERVAL_MS;
        // A hidden tab skips the request. Nobody is looking at the numbers.
        if (!document.hidden) {
          try {
            const res = await fetch(`/api/jobs/${jobId}/stats`, {
              cache: "no-store",
              signal: controller.signal,
              headers: { accept: "application/json" },
            });
            const isJson = res.headers
              .get("content-type")
              ?.includes("application/json");
            // A redirect to the login page answers 200 with HTML.
            if (!res.ok || !isJson) throw new Error(`stats ${res.status}`);
            const live = (await res.json()) as JobLive;
            if (cancelled) return;
            setStats(live.stats);
            setFailed(false);
            setUpdatedAt(new Date());
            if (live.status !== status) {
              router.refresh();
              return;
            }
          } catch {
            if (cancelled) return;
            setFailed(true);
            delay = POLL_INTERVAL_MS * 3;
          }
        }
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, delay);
        });
      }
    }
    void loop();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, status, polling, router]);

  const pct = creditPercent(stats.credits_used, budget);
  const items: { label: string; value: string; note?: string }[] = [
    {
      label: "Credits used",
      value: formatCount(stats.credits_used),
      note: budget > 0 ? `of ${formatCount(budget)}` : "no search budget",
    },
    {
      label: "Queries done",
      value: formatCount(stats.queries_done),
      note: `of ${formatCount(stats.queries_total)}`,
    },
    {
      label: "Unique opportunities",
      value: formatCount(stats.unique_opportunities),
    },
    {
      label: "Duplicates skipped",
      value: formatCount(stats.duplicates_skipped),
    },
    {
      label: "Could not check",
      value: formatCount(stats.unchecked_count),
      note: "kept in the list, ranked lower",
    },
  ];

  let footer: string;
  if (!polling) {
    footer =
      status === "draft"
        ? "Counters start when the job runs."
        : "Final numbers for this job.";
  } else if (failed) {
    footer = "Live updates are paused. Retrying.";
  } else if (updatedAt) {
    footer = `Updated ${updatedAt.toLocaleTimeString()}. Refreshes every ${POLL_INTERVAL_MS / 1000} seconds.`;
  } else {
    footer = `Refreshes every ${POLL_INTERVAL_MS / 1000} seconds.`;
  }

  return (
    <section
      aria-label="Progress"
      className="bg-card space-y-4 rounded-xl border p-5"
    >
      <h2 className="text-base font-semibold tracking-tight">Progress</h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="space-y-0.5">
            <dt className="text-muted-foreground text-sm">{item.label}</dt>
            <dd className="text-sm">
              <span className="text-xl font-semibold tabular-nums">
                {item.value}
              </span>
              {item.note ? (
                <span className="text-muted-foreground ml-1.5">
                  {item.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {budget > 0 ? (
        <div
          role="progressbar"
          aria-label="Search credits used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="bg-muted h-2 overflow-hidden rounded-full"
        >
          <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <p
        role={failed ? "status" : undefined}
        className="text-muted-foreground text-sm"
      >
        {footer}
      </p>
    </section>
  );
}
