"use client";

import { useActionState, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { removeBlockedDomainAction, updateBlockReasonAction } from "./actions";
import { REASON_MAX } from "./rules";

const initialState: FormState = {};

function Spinner() {
  return (
    <Loader2
      aria-hidden
      data-icon="inline-start"
      className="animate-spin motion-reduce:animate-none"
    />
  );
}

/** Edit the reason, or remove the domain after a confirmation. */
export function BlocklistRowActions({
  id,
  domain,
  reason,
}: {
  id: string;
  domain: string;
  reason: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(reason ?? "");

  const [editState, editAction, editPending] = useActionState(
    async (prev: FormState, formData: FormData) => {
      const result = await updateBlockReasonAction(prev, formData);
      if (result.message) setEditing(false);
      return result;
    },
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState(
    removeBlockedDomainAction,
    initialState,
  );

  const error = editState.error ?? removeState.error;

  return (
    <div className="space-y-2">
      {editing ? (
        <form action={editAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Input
            name="reason"
            aria-label={`Reason for blocking ${domain}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={REASON_MAX}
            autoComplete="off"
            autoFocus
            className="max-w-xs min-w-40 flex-1"
          />
          <Button type="submit" size="sm" disabled={editPending}>
            {editPending ? <Spinner /> : null}
            {editPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={editPending}
            onClick={() => {
              setText(reason ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : confirming ? (
        <form
          action={removeAction}
          className="bg-destructive-soft flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
        >
          <input type="hidden" name="id" value={id} />
          <span className="text-sm">
            Unblock <strong>{domain}</strong>?
          </span>
          <Button
            type="submit"
            size="sm"
            variant="destructive"
            disabled={removePending}
          >
            {removePending ? <Spinner /> : null}
            {removePending ? "Removing…" : "Yes, remove"}
          </Button>
          {/* Focus lands on the safe choice. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            autoFocus
            disabled={removePending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`Edit reason for ${domain}`}
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden data-icon="inline-start" />
            Edit reason
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove ${domain}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden data-icon="inline-start" />
            Remove
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
