"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { FormState } from "@/lib/auth/schemas";
import { manageUserAction } from "./actions";
import type { RoleOption, UserRow } from "./types";

const initial: FormState = {};

export function UserActions({
  user,
  roles,
  isSelf,
}: {
  user: UserRow;
  roles: RoleOption[];
  isSelf: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    manageUserAction,
    initial,
  );

  const canPickRole =
    user.status === "pending" ||
    user.status === "rejected" ||
    (user.status === "active" && !isSelf);

  return (
    <form action={formAction} className="space-y-1.5">
      <input type="hidden" name="user_id" value={user.id} />
      <div className="flex flex-wrap items-center gap-2">
        {canPickRole ? (
          <NativeSelect
            name="role_id"
            defaultValue={user.role_id ?? ""}
            aria-label={`Role for ${user.email}`}
            wrapperClassName="w-44"
          >
            <option value="">Choose role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}

        {user.status === "pending" || user.status === "rejected" ? (
          <Button
            type="submit"
            name="intent"
            value="approve"
            size="sm"
            disabled={pending}
          >
            Approve
          </Button>
        ) : null}
        {user.status === "pending" ? (
          <Button
            type="submit"
            name="intent"
            value="reject"
            variant="destructive"
            size="sm"
            disabled={pending}
            formNoValidate
          >
            Reject
          </Button>
        ) : null}

        {user.status === "active" && !isSelf ? (
          <>
            <Button
              type="submit"
              name="intent"
              value="change_role"
              variant="outline"
              size="sm"
              disabled={pending}
            >
              Change role
            </Button>
            <Button
              type="submit"
              name="intent"
              value="deactivate"
              variant="destructive"
              size="sm"
              disabled={pending}
              formNoValidate
            >
              Deactivate
            </Button>
          </>
        ) : null}
        {user.status === "active" ? (
          <Button
            type="submit"
            name="intent"
            value="send_link"
            variant="ghost"
            size="sm"
            disabled={pending}
            formNoValidate
          >
            Send password link
          </Button>
        ) : null}

        {user.status === "deactivated" ? (
          <Button
            type="submit"
            name="intent"
            value="reactivate"
            variant="outline"
            size="sm"
            disabled={pending}
            formNoValidate
          >
            Reactivate
          </Button>
        ) : null}
      </div>
      {state.error ? (
        <p role="alert" className="text-destructive text-xs">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-muted-foreground text-xs">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
