"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { FormState } from "@/lib/auth/schemas";
import { deleteRoleAction } from "./actions";

const initialState: FormState = {};

export function DeleteRoleButton({
  roleId,
  roleName,
  blockedReason,
}: {
  roleId: string;
  roleName: string;
  /** Why deleting is not allowed right now, or null when it is. */
  blockedReason: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    deleteRoleAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);

  if (blockedReason) {
    return <p className="text-muted-foreground text-sm">{blockedReason}</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="role_id" value={roleId} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {confirming ? (
        <div className="bg-destructive-soft space-y-3 rounded-lg p-4">
          <p className="text-sm">
            Delete <strong>{roleName}</strong>? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? (
                <Loader2
                  aria-hidden
                  data-icon="inline-start"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {pending ? "Deleting…" : "Yes, delete role"}
            </Button>
            {/* Focus lands on the safe choice, so Enter cannot delete by accident. */}
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
          Delete role
        </Button>
      )}
    </form>
  );
}
