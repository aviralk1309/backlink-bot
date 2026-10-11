"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
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
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {confirming ? (
        <div className="space-y-3">
          <p className="text-sm">
            Delete <strong>{roleName}</strong>? This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Deleting…" : "Yes, delete role"}
            </Button>
            <Button
              type="button"
              variant="ghost"
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
          variant="destructive"
          onClick={() => setConfirming(true)}
        >
          Delete role
        </Button>
      )}
    </form>
  );
}
