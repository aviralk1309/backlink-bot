"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { WORKER_POLL_MS, type WorkerStatus } from "./workers";

type State =
  | { kind: "loading" }
  | { kind: "hidden" } // no permission: render nothing, stop polling
  | { kind: "error" }
  | { kind: "ok"; status: WorkerStatus };

/** Topbar indicator for admins: is at least one worker alive? */
export function WorkerStatusBadge() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function loop() {
      while (!cancelled) {
        // A hidden tab skips the request. Nobody is looking at the badge.
        if (!document.hidden) {
          try {
            const res = await fetch("/api/system/workers", {
              cache: "no-store",
              signal: controller.signal,
              headers: { accept: "application/json" },
            });
            if (res.status === 401 || res.status === 403) {
              if (!cancelled) setState({ kind: "hidden" });
              return;
            }
            const isJson = res.headers
              .get("content-type")
              ?.includes("application/json");
            if (!res.ok || !isJson) throw new Error(`workers ${res.status}`);
            const status = (await res.json()) as WorkerStatus;
            if (cancelled) return;
            setState({ kind: "ok", status });
          } catch {
            if (cancelled) return;
            setState({ kind: "error" });
          }
        }
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, WORKER_POLL_MS);
        });
      }
    }
    void loop();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === "loading" || state.kind === "hidden") return null;

  const online = state.kind === "ok" && state.status.online > 0;
  const label =
    state.kind === "error"
      ? "Worker status unavailable"
      : online
        ? "Worker online"
        : "No worker online";
  const title =
    state.kind === "ok"
      ? `${state.status.online} online, ${state.status.known} seen`
      : undefined;

  return (
    <span
      role="status"
      title={title}
      className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-sm"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state.kind === "error"
            ? "bg-muted-foreground"
            : online
              ? "bg-success"
              : "bg-destructive",
        )}
      />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}
