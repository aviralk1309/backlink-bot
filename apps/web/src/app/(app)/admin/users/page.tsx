import Link from "next/link";
import { format } from "date-fns";
import { InviteForm } from "@/features/users/invite-form";
import { listRoles, listUsers } from "@/features/users/queries";
import { Suspense } from "react";
import {
  parseFilter,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/features/users/rules";
import type { UserRow } from "@/features/users/types";
import { UserActions } from "@/features/users/user-actions";
import { requirePagePermission } from "@/lib/auth/guard";

const STATUS_STYLE: Record<UserRow["status"], string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  active: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  deactivated: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};
type Props = { searchParams: Promise<{ status?: string }> };

function StatusBadge({ status }: { status: UserRow["status"] }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status}
    </span>
  );
}

export default function AdminUsersPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <UsersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function UsersContent({ searchParams }: Props) {
  const session = await requirePagePermission("users.manage");

  const filter: StatusFilter = parseFilter((await searchParams).status);
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);

  const counts: Record<StatusFilter, number> = {
    all: users.length,
    pending: 0,
    active: 0,
    rejected: 0,
    deactivated: 0,
  };
  for (const u of users) counts[u.status] += 1;

  const shown = users
    .filter((u) => filter === "all" || u.status === filter)
    // Pending requests first, so nothing waiting for approval gets buried.
    .sort(
      (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
    );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Approve sign-up requests, invite people, and manage roles.
        </p>
      </div>

      <details className="rounded-md border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Invite a user
        </summary>
        <InviteForm roles={roles} />
      </details>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/users" : `/admin/users?status=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm capitalize ${
              f === filter
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f} ({counts[f]})
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">No users here.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">User</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Joined</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">
                      {u.full_name || "(no name)"}
                      {u.id === session.userId ? (
                        <span className="text-muted-foreground ml-2 text-xs font-normal">
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {u.email}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3">{u.role_name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {format(new Date(u.created_at), "d MMM yyyy")}
                  </td>
                  <td className="px-4 py-3">
                    <UserActions
                      user={u}
                      roles={roles}
                      isSelf={u.id === session.userId}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
