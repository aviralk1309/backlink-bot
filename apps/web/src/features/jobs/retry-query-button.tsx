"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { retryJobQueryAction } from "./actions";

export function RetryQueryButton({
  jobId,
  queryId,
}: {
  jobId: string;
  queryId: string;
}) {
  const [state, action, pending] = useActionState(
    retryJobQueryAction,
    {} as FormState,
  );
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="query_id" value={queryId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Retrying…" : "Retry"}
      </Button>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
    </form>
  );
}
