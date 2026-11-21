"use client";

import { useActionState } from "react";
import { ArrowUpToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { releaseBacklogAction } from "./actions";
import type { JobQueueCounts } from "./queries";

export function QueuePanel({
  jobId,
  counts,
  queueLimit,
  canRelease,
}: {
  jobId: string;
  counts: JobQueueCounts;
  queueLimit: number;
  canRelease: boolean;
}) {
  const [state, action, pending] = useActionState(
    releaseBacklogAction,
    {} as FormState,
  );
  return (
    <section
      aria-label="Review queue"
      className="bg-card space-y-3 rounded-xl border p-5"
    >
      <div>
        <h2 className="text-base font-semibold tracking-tight">Review queue</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {counts.pending} of {queueLimit} pending · {counts.backlog} Backlog ·{" "}
          {counts.ready} Ready total
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Ready results stay visible until reviewed. Later results wait in
          Backlog when the queue is full.
        </p>
      </div>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {canRelease && counts.backlog > 0 ? (
        <form action={action}>
          <input type="hidden" name="job_id" value={jobId} />
          <Button
            type="submit"
            variant="outline"
            disabled={pending || counts.pending >= queueLimit}
          >
            <ArrowUpToLine aria-hidden data-icon="inline-start" />
            {pending ? "Releasing…" : "Release next batch"}
          </Button>
          {counts.pending >= queueLimit ? (
            <p className="text-muted-foreground mt-2 text-xs">
              The pending queue is full. Review results to make room for the
              next batch.
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
