"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { addBlockedDomainsAction } from "./actions";
import { MAX_BATCH, REASON_MAX } from "./rules";

const initialState: FormState = {};

/**
 * Paste one domain or a whole list. The fields are controlled and only
 * cleared after a successful add, so a typo in a long paste is never lost.
 */
export function AddBlockedDomains() {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");

  const [state, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await addBlockedDomainsAction(prev, formData);
      if (result.message) {
        setText("");
        setReason("");
      }
      return result;
    },
    initialState,
  );

  return (
    <form
      action={formAction}
      aria-label="Add blocked domains"
      className="space-y-3 rounded-md border p-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="block_domains" className="text-sm font-medium">
          Domains to block
        </label>
        <textarea
          id="block_domains"
          name="domains"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          required
          placeholder={"spamsite.com\nanother-example.net"}
          aria-describedby="block_domains_hint"
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3"
        />
        <p id="block_domains_hint" className="text-muted-foreground text-xs">
          One or many, separated by spaces, commas or new lines (up to{" "}
          {MAX_BATCH}). Web addresses are cleaned to the domain. Domains already
          on the list are skipped.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="block_reason" className="text-sm font-medium">
          Reason <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="block_reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={REASON_MAX}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Block domains"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
        {state.message ? (
          <p role="status" className="text-sm">
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
