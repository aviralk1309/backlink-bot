import Link from "next/link";
import { Suspense } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { savedNotice } from "@/features/roles/notice";
import { listPermissions, listRoleDetails } from "@/features/roles/queries";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { searchParams: Promise<{ saved?: string }> };

export default function AdminRolesPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RolesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function RolesContent({ searchParams }: Props) {
  const session = await requirePagePermission("roles.manage");

  const [roles, permissions, params] = await Promise.all([
    listRoleDetails(),
    listPermissions(),
    searchParams,
  ]);
  const notice = savedNotice(params.saved);

  const newRoleLink = (
    <Link href="/admin/roles/new" className={buttonVariants()}>
      <Plus aria-hidden data-icon="inline-start" />
      New role
    </Link>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-muted-foreground max-w-xl text-sm">
            Choose exactly what each role can do. The Admin role is protected
            and always keeps user and role management.
          </p>
        </div>
        {newRoleLink}
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {roles.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="No roles yet"
          description="Create a role to control what people can do."
          action={newRoleLink}
        />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Users</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="px-4 py-3 whitespace-normal">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {r.is_system ? (
                        <StatusBadge tone="neutral">system</StatusBadge>
                      ) : null}
                      {r.is_protected ? (
                        <StatusBadge tone="brand">protected</StatusBadge>
                      ) : null}
                      {r.id === session.roleId ? (
                        <span className="bg-accent text-accent-foreground rounded-full px-1.5 py-0.5 text-xs">
                          your role
                        </span>
                      ) : null}
                    </div>
                    {r.description ? (
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {r.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="px-4 py-3">{r.user_count}</TableCell>
                  <TableCell className="px-4 py-3 whitespace-nowrap">
                    {r.permission_count} of {permissions.length}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/roles/${r.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Edit
                      </Link>
                      <Link
                        href={`/admin/roles/new?from=${r.id}`}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "sm",
                        })}
                      >
                        Clone
                      </Link>
                    </div>
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
