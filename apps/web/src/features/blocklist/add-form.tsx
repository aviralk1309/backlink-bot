"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
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
      className="bg-card space-y-4 rounded-xl border p-5"
    >
      <div className="space-y-1.5">
        <label htmlFor="block_domains" className="text-sm font-medium">
          Domains to block
        </label>
        <Textarea
          id="block_domains"
          name="domains"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          required
          placeholder={"spamsite.com\nanother-example.net"}
          aria-describedby="block_domains_hint"
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
          {pending ? (
            <Loader2
              aria-hidden
              data-icon="inline-start"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {pending ? "Adding…" : "Block domains"}
        </Button>
        {state.error ? (
          <Notice tone="error" className="min-w-0 flex-1">
            {state.error}
          </Notice>
        ) : null}
        {state.message ? (
          <Notice tone="success" className="min-w-0 flex-1">
            {state.message}
          </Notice>
        ) : null}
      </div>
    </form>
  );
}
