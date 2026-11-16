"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { reviewResultsAction, type ReviewActionState } from "./actions";
import type { ResultDetail } from "./queries";
import { REJECT_REASONS } from "./review-input";

const STATUS_LABELS = {
  new: "New",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  used: "Used",
};

export function ReviewActions({
  detail,
  jobId,
  nextHref,
  domainReviewHref,
  closeHref,
  canReview,
  canReopen,
}: {
  detail: ResultDetail;
  jobId: string;
  nextHref: string | null;
  domainReviewHref: string;
  closeHref: string;
  canReview: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    reviewResultsAction,
    {} as ReviewActionState,
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const claimButton = useRef<HTMLButtonElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const usedButton = useRef<HTMLButtonElement>(null);
  const reopenButton = useRef<HTMLButtonElement>(null);
  const reasonSelect = useRef<HTMLSelectElement>(null);
  const nextAfterDecision = useRef(nextHref);
  const [heldNext, setHeldNext] = useState(nextHref);
  const availableNext = nextHref ?? heldNext;
  const hasScoring = detail.score !== null && detail.score_breakdown !== null;

  useEffect(() => {
    if (
      state.message &&
      ["approve", "reject", "used"].includes(state.intent ?? "")
    )
      router.replace(nextAfterDecision.current ?? closeHref, { scroll: false });
  }, [state, closeHref, router]);

  useEffect(() => {
    if (rejecting) reasonSelect.current?.focus();
  }, [rejecting]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        pending ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input, textarea, select, [contenteditable]"))
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "n" && availableNext) {
        event.preventDefault();
        router.replace(availableNext, { scroll: false });
      }
      if (
        key === "c" &&
        canReview &&
        hasScoring &&
        detail.review_status === "new"
      ) {
        event.preventDefault();
        claimButton.current?.click();
      }
      if (
        key === "a" &&
        canReview &&
        hasScoring &&
        detail.review_status === "in_review" &&
        !rejecting
      ) {
        event.preventDefault();
        approveButton.current?.click();
      }
      if (
        key === "r" &&
        canReview &&
        hasScoring &&
        detail.review_status === "in_review"
      ) {
        event.preventDefault();
        setRejecting(true);
      }
      if (
        key === "u" &&
        canReview &&
        hasScoring &&
        detail.review_status === "approved"
      ) {
        event.preventDefault();
        usedButton.current?.click();
      }
      if (
        key === "o" &&
        canReopen &&
        ["approved", "rejected", "used"].includes(detail.review_status)
      ) {
        event.preventDefault();
        reopenButton.current?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    canReview,
    canReopen,
    hasScoring,
    detail.review_status,
    availableNext,
    pending,
    rejecting,
    router,
  ]);

  const shortcuts = [
    canReview && hasScoring && detail.review_status === "new" && "C start",
    canReview &&
      hasScoring &&
      detail.review_status === "in_review" &&
      "A approve · R reject",
    canReview && hasScoring && detail.review_status === "approved" && "U used",
    canReopen &&
      ["approved", "rejected", "used"].includes(detail.review_status) &&
      "O reopen",
    availableNext && "N next",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-3" aria-label="Review decision">
      <h3 className="font-semibold">Review decision</h3>
      <p className="text-sm">
        {STATUS_LABELS[detail.review_status]}
        {detail.reviewer_name && detail.review_status !== "new"
          ? ` · ${detail.review_status === "in_review" ? "Claimed by" : "Last reviewed by"} ${detail.reviewer_name}`
          : ""}
        {detail.reject_reason
          ? ` · ${REJECT_REASONS[detail.reject_reason]}`
          : ""}
      </p>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      {canReview &&
      !hasScoring &&
      ["new", "in_review", "approved"].includes(detail.review_status) ? (
        <Notice tone="info">
          A score and scoring details are required before a review decision.
        </Notice>
      ) : null}
      {detail.domain_spam ? (
        <Notice tone="info">
          This domain has a global spam flag.{" "}
          {canReview ? (
            <Link href={domainReviewHref} className="underline">
              View this job&apos;s In review URLs to select and bulk reject
              them.
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {canReview && detail.review_status === "approved" ? (
        <p className="text-muted-foreground text-xs">
          Mark used only after the backlink is live.
        </p>
      ) : null}
      {canReview || canReopen ? (
        <form
          action={action}
          onSubmit={() => {
            if (nextHref) {
              nextAfterDecision.current = nextHref;
              setHeldNext(nextHref);
            }
          }}
          className="space-y-3"
        >
          <input type="hidden" name="job_id" value={jobId} />
          <input
            type="hidden"
            name="row"
            value={`${detail.id}:${detail.row_version}`}
          />
          <div className="flex flex-wrap gap-2">
            {canReview && hasScoring && detail.review_status === "new" ? (
              <Button
                ref={claimButton}
                type="submit"
                name="intent"
                value="claim"
                disabled={pending}
              >
                Start review
              </Button>
            ) : null}
            {canReview &&
            hasScoring &&
            detail.review_status === "in_review" &&
            !rejecting ? (
              <>
                <Button
                  ref={approveButton}
                  type="submit"
                  name="intent"
                  value="approve"
                  disabled={pending}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setRejecting(true)}
                >
                  Reject
                </Button>
              </>
            ) : null}
            {canReview && hasScoring && detail.review_status === "approved" ? (
              <Button
                ref={usedButton}
                type="submit"
                name="intent"
                value="used"
                disabled={pending}
              >
                Mark used
              </Button>
            ) : null}
            {canReopen &&
            ["approved", "rejected", "used"].includes(detail.review_status) ? (
              <Button
                ref={reopenButton}
                type="submit"
                name="intent"
                value="reopen"
                variant="outline"
                disabled={pending}
              >
                Reopen for review
              </Button>
            ) : null}
          </div>
          {canReview &&
          hasScoring &&
          detail.review_status === "in_review" &&
          rejecting ? (
            <div className="space-y-3 rounded-lg border p-3">
              <label className="block space-y-1 text-sm">
                <span>Reject reason</span>
                <NativeSelect
                  ref={reasonSelect}
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
              <label className="block space-y-1 text-sm">
                <span>
                  Decision note
                  {reason === "other"
                    ? " (required)"
                    : " (optional, appended to notes)"}
                </span>
                <Textarea
                  name="note"
                  maxLength={4000}
                  rows={3}
                  required={reason === "other"}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  name="intent"
                  value="reject"
                  disabled={pending}
                >
                  {pending ? "Saving…" : "Confirm rejection"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setRejecting(false);
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        {shortcuts ? (
          <p className="text-muted-foreground text-xs">
            Shortcuts: {shortcuts}
          </p>
        ) : null}
        {availableNext ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.replace(availableNext, { scroll: false })}
          >
            Next result
          </Button>
        ) : null}
      </div>
    </section>
  );
}
