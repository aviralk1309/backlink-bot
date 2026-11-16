"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { rescoreJobAction } from "./actions";

export function RescoreButton({ jobId }: { jobId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    rescoreJobAction,
    {} as FormState,
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="job_id" value={jobId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {confirming ? (
        <div className="bg-muted/50 space-y-3 rounded-xl border p-4">
          <p className="text-sm">
            Apply the current activity weights and tier thresholds to stored
            checks? Scores, tiers and explanations will change. Review decisions
            and queue positions stay the same. No pages will be fetched.
            Filtered and duplicate results are excluded.
          </p>
          <div className="flex gap-2">
            <Button
              type="submit"
              name="confirmed"
              value="yes"
              disabled={pending}
            >
              {pending ? "Requesting…" : "Yes, rescore"}
            </Button>
            <Button
              type="button"
              variant="outline"
              autoFocus
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          Rescore
        </Button>
      )}
    </form>
  );
}
