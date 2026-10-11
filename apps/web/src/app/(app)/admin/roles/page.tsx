import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { savedNotice } from "@/features/roles/notice";
import { listPermissions, listRoleDetails } from "@/features/roles/queries";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { searchParams: Promise<{ saved?: string }> };

function Badge({
  children,
  tone,
}: {
  children: string;
  tone: "system" | "protected";
}) {
  const style =
    tone === "protected"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {children}
    </span>
  );
}

export default function AdminRolesPage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-muted-foreground text-sm">
            Choose exactly what each role can do. The Admin role is protected
            and always keeps user and role management.
          </p>
        </div>
        <Link
          href="/admin/roles/new"
          className={buttonVariants({ size: "default" })}
        >
          New role
        </Link>
      </div>

      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}

      {roles.length === 0 ? (
        <p className="text-muted-foreground text-sm">No roles yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Users</th>
                <th className="px-4 py-2 font-medium">Permissions</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      {r.is_system ? <Badge tone="system">system</Badge> : null}
                      {r.is_protected ? (
                        <Badge tone="protected">protected</Badge>
                      ) : null}
                      {r.id === session.roleId ? (
                        <span className="text-muted-foreground text-xs">
                          your role
                        </span>
                      ) : null}
                    </div>
                    {r.description ? (
                      <div className="text-muted-foreground text-xs">
                        {r.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{r.user_count}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.permission_count} of {permissions.length}
                  </td>
                  <td className="px-4 py-3">
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
