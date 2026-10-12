"use client";

import { useActionState, useState } from "react";
import { Loader2, Pause, Play, Square, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { cn } from "@/lib/utils";
import { deleteJobAction, jobTransitionAction } from "./actions";
import type { JobAction, JobStatus } from "./types";

const initialState: FormState = {};

const LABEL: Record<JobAction, string> = {
  start: "Start job",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop job",
};

const PENDING_LABEL: Record<JobAction, string> = {
  start: "Starting…",
  pause: "Pausing…",
  resume: "Resuming…",
  stop: "Stopping…",
};

const ICON: Record<JobAction, LucideIcon> = {
  start: Play,
  pause: Pause,
  resume: Play,
  stop: Square,
};

/** Start, stop and resuming a Saturated job ask "are you sure?" first. */
function needsConfirm(action: JobAction, status: JobStatus): boolean {
  return (
    action === "start" ||
    action === "stop" ||
    (action === "resume" && status === "saturated")
  );
}

function confirmText(
  action: JobAction,
  status: JobStatus,
  budget: number,
): string {
  if (action === "start") {
    return budget > 0
      ? `Start this job? It can use up to ${budget.toLocaleString("en")} Serper credits. After it starts, changing its settings creates a new settings version.`
      : "Start this job? After it starts, changing its settings creates a new settings version.";
  }
  if (action === "stop") {
    return "Stop this job? A stopped job cannot be started again, and its settings become read-only.";
  }
  if (action === "resume" && status === "saturated") {
    return "This job paused itself because the latest queries found too few new domains. Resume anyway? It may use more credits for little gain.";
  }
  return "";
}

function Spinner() {
  return (
    <Loader2
      aria-hidden
      data-icon="inline-start"
      className="animate-spin motion-reduce:animate-none"
    />
  );
}

/**
 * The buttons for the transitions this user may make from the current
 * status. `actions` is already filtered by status and permission on the
 * server; the server action and the database check both again.
 */
export function JobActions({
  jobId,
  status,
  budget,
  actions,
}: {
  jobId: string;
  status: JobStatus;
  budget: number;
  actions: readonly JobAction[];
}) {
  const [state, formAction, pending] = useActionState(
    jobTransitionAction,
    initialState,
  );
  const [asking, setAsking] = useState<JobAction | null>(null);
  // If the status changes under us the button may be gone: ask nothing.
  const active = asking && actions.includes(asking) ? asking : null;

  // After the last action (a stop) there are no buttons left, but the
  // result message should still be shown.
  if (actions.length === 0 && !state.message && !state.error) return null;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="job_id" value={jobId} />
      {active && status === "saturated" && active === "resume" ? (
        <input type="hidden" name="confirm" value="yes" />
      ) : null}

      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}

      {active ? (
        <div
          className={cn(
            "space-y-3 rounded-xl border p-4",
            active === "stop"
              ? "bg-destructive-soft border-transparent"
              : "bg-muted/50",
          )}
        >
          <p className="text-sm">{confirmText(active, status, budget)}</p>
          {active === "stop" ? (
            <Input
              name="reason"
              aria-label="Reason for stopping (optional)"
              placeholder="Reason (optional)"
              maxLength={200}
              disabled={pending}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              name="action"
              value={active}
              variant={active === "stop" ? "destructive" : "default"}
              disabled={pending}
            >
              {pending ? <Spinner /> : null}
              {pending
                ? PENDING_LABEL[active]
                : `Yes, ${LABEL[active].toLowerCase()}`}
            </Button>
            {/* Focus lands on the safe choice, so Enter cannot start or stop by accident. */}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              autoFocus
              onClick={() => setAsking(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => {
            const Icon = ICON[action];
            return needsConfirm(action, status) ? (
              <Button
                key={action}
                type="button"
                variant={action === "stop" ? "outline" : "default"}
                onClick={() => setAsking(action)}
              >
                <Icon aria-hidden data-icon="inline-start" />
                {LABEL[action]}
              </Button>
            ) : (
              <Button
                key={action}
                type="submit"
                name="action"
                value={action}
                variant="outline"
                disabled={pending}
              >
                {pending ? (
                  <Spinner />
                ) : (
                  <Icon aria-hidden data-icon="inline-start" />
                )}
                {pending ? PENDING_LABEL[action] : LABEL[action]}
              </Button>
            );
          })}
        </div>
      )}
    </form>
  );
}

export function DeleteJobButton({
  jobId,
  jobName,
  blockedReason,
}: {
  jobId: string;
  jobName: string;
  /** Why deleting is not allowed right now, or null when it is. */
  blockedReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    deleteJobAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);

  if (blockedReason) {
    return <p className="text-muted-foreground text-sm">{blockedReason}</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="job_id" value={jobId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {confirming ? (
        <div className="bg-destructive-soft space-y-3 rounded-lg p-4">
          <p className="text-sm">
            Delete <strong>{jobName}</strong>? Its settings and activity log are
            removed. This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? <Spinner /> : null}
              {pending ? "Deleting…" : "Yes, delete job"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              autoFocus
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          Delete job
        </Button>
      )}
    </form>
  );
}
