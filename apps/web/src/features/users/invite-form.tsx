"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { inviteUserAction } from "./actions";
import type { RoleOption } from "./types";

const initial: FormState = {};

export function InviteForm({ roles }: { roles: RoleOption[] }) {
  const [state, formAction, pending] = useActionState(
    inviteUserAction,
    initial,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="invite_full_name" className="text-sm font-medium">
            Full name
          </label>
          <Input
            id="invite_full_name"
            name="full_name"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite_email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="invite_email"
            name="email"
            type="email"
            autoComplete="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="invite_role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="invite_role"
            name="role_id"
            required
            defaultValue=""
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="" disabled>
              Choose role…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
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
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send invite"}
      </Button>
    </form>
  );
}
