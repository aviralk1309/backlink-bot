import Link from "next/link";
import { Suspense } from "react";
import { format } from "date-fns";
import { ChevronRight, Search, Users as UsersIcon } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InviteForm } from "@/features/users/invite-form";
import { listRoles, listUsers } from "@/features/users/queries";
import {
  parseFilter,
  STATUS_FILTERS,
  type StatusFilter,
} from "@/features/users/rules";
import type { UserRow } from "@/features/users/types";
import { UserActions } from "@/features/users/user-actions";
import { requirePagePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  pending: "warning",
  active: "success",
  rejected: "danger",
  deactivated: "neutral",
} as const satisfies Record<
  UserRow["status"],
  "warning" | "success" | "danger" | "neutral"
>;

type Props = { searchParams: Promise<{ status?: string; q?: string }> };

function filterHref(filter: StatusFilter, q: string) {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("status", filter);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/admin/users?${query}` : "/admin/users";
}

export default function AdminUsersPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <UsersContent searchParams={searchParams} />
    </Suspense>
  );
}

async function UsersContent({ searchParams }: Props) {
  const session = await requirePagePermission("users.manage");

  const sp = await searchParams;
  const filter: StatusFilter = parseFilter(sp.status);
  const q = (sp.q ?? "").trim().slice(0, 100);
  const needle = q.toLowerCase();
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
    .filter(
      (u) =>
        !needle ||
        u.email.toLowerCase().includes(needle) ||
        (u.full_name || "").toLowerCase().includes(needle),
    )
    // Pending requests first, so nothing waiting for approval gets buried.
    .sort(
      (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
    );

  const filtered = q !== "" || filter !== "all";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">
          Approve sign-up requests, invite people, and manage roles.
        </p>
      </div>

      <details className="group bg-card rounded-xl border">
        <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden
            className="text-muted-foreground size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          />
          Invite a user
        </summary>
        <div className="border-t px-4 pb-4">
          <InviteForm roles={roles} />
        </div>
      </details>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Filter by status"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1"
        >
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f}
              href={filterHref(f, q)}
              aria-current={f === filter ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium capitalize transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11",
                f === filter
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {f} ({counts[f]})
            </Link>
          ))}
        </nav>

        <form
          role="search"
          action="/admin/users"
          className="flex w-full gap-2 sm:max-w-sm"
        >
          {filter !== "all" ? (
            <input type="hidden" name="status" value={filter} />
          ) : null}
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or email"
              aria-label="Search users"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title={filtered ? "No users match" : "No users yet"}
          description={
            filtered
              ? "Try a different search or status."
              : "Invite someone to get started."
          }
          action={
            filtered ? (
              <Link
                href="/admin/users"
                className={buttonVariants({ variant: "outline" })}
              >
                Clear filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((u) => (
                <TableRow key={u.id} className="align-top">
                  <TableCell className="px-4 py-3">
                    <div className="font-medium">
                      {u.full_name || "(no name)"}
                      {u.id === session.userId ? (
                        <span className="bg-accent text-accent-foreground ml-2 rounded-full px-1.5 py-0.5 text-xs font-normal">
                          you
                        </span>
                      ) : null}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {u.email}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusBadge
                      tone={STATUS_TONE[u.status]}
                      className="capitalize"
                    >
                      {u.status}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    {u.role_name ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap">
                    {format(new Date(u.created_at), "d MMM yyyy")}
                  </TableCell>
                  <TableCell className="min-w-72 px-4 py-3 whitespace-normal">
                    <UserActions
                      user={u}
                      roles={roles}
                      isSelf={u.id === session.userId}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
