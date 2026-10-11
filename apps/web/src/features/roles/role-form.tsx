"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/schemas";
import { saveRoleAction } from "./actions";
import {
  enforceLocked,
  filterGroups,
  groupState,
  setKeys,
  toggleKey,
  type LockedMap,
} from "./rules";
import type { PermissionGroup } from "./types";

const initialState: FormState = {};

export type RoleFormValues = {
  /** null when creating (also when cloning). */
  id: string | null;
  name: string;
  description: string;
  keys: string[];
};

const isLocked = (locked: LockedMap, key: string) => Object.hasOwn(locked, key);

export function RoleForm({
  groups,
  role,
  locked,
}: {
  groups: PermissionGroup[];
  role: RoleFormValues;
  locked: LockedMap;
}) {
  const [state, formAction, pending] = useActionState(
    saveRoleAction,
    initialState,
  );

  // Controlled fields: React resets uncontrolled form fields after an
  // action finishes, which would wipe the user's edits on a server error.
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [selected, setSelected] = useState<Set<string>>(() =>
    enforceLocked(new Set(role.keys), locked),
  );
  const [query, setQuery] = useState("");

  const visible = useMemo(() => filterGroups(groups, query), [groups, query]);
  const total = useMemo(
    () => groups.reduce((n, g) => n + g.permissions.length, 0),
    [groups],
  );

  const apply = (next: Set<string>) => setSelected(enforceLocked(next, locked));

  return (
    <form action={formAction} className="space-y-6">
      {role.id ? <input type="hidden" name="role_id" value={role.id} /> : null}
      {/* The matrix may be filtered, so submit from state, not from the
          visible checkboxes. */}
      {[...selected].sort().map((k) => (
        <input key={k} type="hidden" name="permission_keys" value={k} />
      ))}

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="role_name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="role_name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={50}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="role_description" className="text-sm font-medium">
            Description{" "}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="role_description"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            rows={2}
            className="border-input bg-background w-full rounded-lg border px-2.5 py-1.5 text-sm"
          />
        </div>
      </div>

      <section aria-label="Permissions" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Permissions
            </h2>
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {selected.size} of {total} selected
            </p>
          </div>
          <div className="w-full sm:w-64">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search permissions…"
              aria-label="Search permissions"
              autoComplete="off"
            />
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No permissions match “{query}”.
          </p>
        ) : (
          visible.map((g) => {
            const keys = g.permissions.map((p) => p.key);
            const gState = groupState(selected, keys);
            const allLocked = keys.every((k) => isLocked(locked, k));
            const checked = selected;
            return (
              <div
                key={g.name}
                role="group"
                aria-label={g.name}
                className="rounded-md border"
              >
                <div className="bg-muted/50 flex items-center justify-between gap-3 border-b px-4 py-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={gState === "all"}
                      disabled={allLocked}
                      ref={(el) => {
                        if (el) el.indeterminate = gState === "some";
                      }}
                      onChange={() =>
                        apply(setKeys(selected, keys, gState !== "all"))
                      }
                      aria-label={`Select all ${g.name} permissions`}
                    />
                    {g.name}
                  </label>
                  <span className="text-muted-foreground text-xs">
                    {keys.filter((k) => checked.has(k)).length} of {keys.length}
                  </span>
                </div>
                <ul className="divide-y">
                  {g.permissions.map((p) => {
                    const lockReason = locked[p.key];
                    return (
                      <li key={p.key} className="px-4 py-2">
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={selected.has(p.key)}
                            disabled={isLocked(locked, p.key)}
                            onChange={() => apply(toggleKey(selected, p.key))}
                          />
                          <span>
                            <span className="font-medium">{p.key}</span>
                            <span className="text-muted-foreground block text-xs">
                              {p.description}
                              {lockReason ? ` ${lockReason}` : ""}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save role"}
        </Button>
        <Link
          href="/admin/roles"
          className={buttonVariants({ variant: "ghost" })}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
