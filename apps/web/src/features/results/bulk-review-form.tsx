"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { reviewResultsAction, type ReviewActionState } from "./actions";
import { REJECT_REASONS } from "./review-input";

export function BulkReviewForm({
  jobId,
  children,
  enabled,
}: {
  jobId: string;
  children: ReactNode;
  enabled: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState(0);
  const [intent, setIntent] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(
    reviewResultsAction,
    {} as ReviewActionState,
  );

  if (!enabled) return <>{children}</>;

  return (
    <form
      ref={formRef}
      action={action}
      onChange={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.name === "select_all") {
          formRef.current
            ?.querySelectorAll<HTMLInputElement>('input[name="row"]')
            .forEach((box) => {
              box.checked = target.checked;
            });
        }
        if (target.name === "row" || target.name === "select_all") {
          const count =
            formRef.current?.querySelectorAll('input[name="row"]:checked')
              .length ?? 0;
          const all = formRef.current?.querySelector<HTMLInputElement>(
            'input[name="select_all"]',
          );
          if (all && target.name === "row")
            all.checked =
              count ===
              formRef.current?.querySelectorAll('input[name="row"]').length;
          setSelected(count);
        }
      }}
    >
      <input type="hidden" name="job_id" value={jobId} />
      {children}
      <div className="space-y-3 border-t p-3 text-sm">
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
        {intent ? (
          <div className="space-y-3 rounded-lg border p-3">
            <p className="font-medium">
              Confirm {intent} for {selected} selected result
              {selected === 1 ? "" : "s"}?
            </p>
            <input type="hidden" name="intent" value={intent} />
            {intent === "reject" ? (
              <>
                <label className="block space-y-1">
                  <span>Shared reject reason</span>
                  <NativeSelect
                    name="reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    required
                  >
                    <option value="">Choose a reason</option>
                    {Object.entries(REJECT_REASONS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="block space-y-1">
                  <span>
                    Shared decision note
                    {reason === "other" ? " (required)" : " (optional)"}
                  </span>
                  <Textarea
                    name="note"
                    maxLength={4000}
                    rows={3}
                    required={reason === "other"}
                  />
                </label>
              </>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || selected === 0}>
                {pending ? "Saving…" : `Confirm ${intent}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setIntent(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground mr-auto">
              {selected} selected from In review
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={selected === 0}
              onClick={() => setIntent("approve")}
            >
              Approve selected
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={selected === 0}
              onClick={() => setIntent("reject")}
            >
              Reject selected
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
