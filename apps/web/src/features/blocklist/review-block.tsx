"use client";

import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { blockFromReviewAction, type ReviewBlockState } from "./actions";
import { REASON_MAX } from "./rules";

type Undo = NonNullable<ReviewBlockState["undo"]>;

function subscribeUndo(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("review-block-undo", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("review-block-undo", callback);
  };
}

function storedUndo(raw: string | null, domain: string): Undo | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Undo>;
    return typeof value.id === "string" &&
      typeof value.jobId === "string" &&
      value.domain === domain &&
      typeof value.reason === "string"
      ? (value as Undo)
      : null;
  } catch {
    return null;
  }
}

export function BlockFromReview({
  jobId,
  domain,
  resultId,
  defaultReason,
  rejectScope,
}: {
  jobId: string;
  domain: string;
  resultId?: string;
  defaultReason: string;
  rejectScope?: string | null;
}) {
  const [state, action, pending] = useActionState(
    blockFromReviewAction,
    {} as ReviewBlockState,
  );
  const [reason, setReason] = useState(defaultReason);
  const storageKey = `review-block-undo:${domain}`;
  const storedRaw = useSyncExternalStore(
    subscribeUndo,
    () => {
      try {
        return sessionStorage.getItem(storageKey);
      } catch {
        return undefined;
      }
    },
    () => null,
  );

  useEffect(() => {
    if (state.undo === undefined) return;
    try {
      if (state.undo)
        sessionStorage.setItem(storageKey, JSON.stringify(state.undo));
      else sessionStorage.removeItem(storageKey);
      window.dispatchEvent(new Event("review-block-undo"));
    } catch {
      // The visible Undo action still works until this view closes.
    }
  }, [state.undo, storageKey]);

  const undo =
    storedRaw === undefined ? state.undo : storedUndo(storedRaw, domain);

  return (
    <section
      className="space-y-3 rounded-lg border p-3"
      aria-label={`Global blocklist: ${domain}`}
    >
      <h3 className="font-semibold">Global blocklist</h3>
      <p className="text-sm break-all">
        Scope: <strong>all jobs</strong>. New URLs from{" "}
        <strong>{domain}</strong> will be auto-filtered before fetching.
        Existing results are unchanged.
      </p>
      {rejectScope && rejectScope !== "global" ? (
        <p className="text-muted-foreground text-xs">
          This result&apos;s rejection is {rejectScope}-scoped. Adding the
          domain here expands the block to all jobs.
        </p>
      ) : null}
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {undo ? (
        <form action={action}>
          <input type="hidden" name="intent" value="undo" />
          <input type="hidden" name="id" value={undo.id} />
          <input type="hidden" name="job_id" value={undo.jobId} />
          <input type="hidden" name="domain" value={undo.domain} />
          <input type="hidden" name="reason" value={undo.reason} />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Undoing…" : "Undo block"}
          </Button>
        </form>
      ) : state.blocked ? null : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="job_id" value={jobId} />
          {resultId ? (
            <input type="hidden" name="result_id" value={resultId} />
          ) : (
            <input type="hidden" name="domain" value={domain} />
          )}
          <label className="min-w-48 flex-1 space-y-1 text-sm">
            <span>Reason</span>
            <Input
              name="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REASON_MAX}
              required
              disabled={pending}
            />
          </label>
          <Button type="submit" disabled={pending || !reason.trim()}>
            {pending ? (
              <Loader2
                aria-hidden
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {pending ? "Adding…" : "Add to global blocklist"}
          </Button>
        </form>
      )}
    </section>
  );
}
