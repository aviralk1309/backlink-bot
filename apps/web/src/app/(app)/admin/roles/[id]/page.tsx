import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/guard";
import { DeleteRoleButton } from "@/features/roles/delete-role-button";
import { getRoleDetail, listPermissions } from "@/features/roles/queries";
import { RoleForm } from "@/features/roles/role-form";
import {
  groupPermissions,
  lockedPermissions,
  planRoleDelete,
} from "@/features/roles/rules";

type Props = { params: Promise<{ id: string }> };

export default function EditRolePage({ params }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <EditRoleContent params={params} />
    </Suspense>
  );
}

async function EditRoleContent({ params }: Props) {
  const session = await requirePagePermission("roles.manage");

  const { id } = await params;
  const [role, permissions] = await Promise.all([
    getRoleDetail(id),
    listPermissions(),
  ]);
  if (!role) notFound();

  const isOwnRole = role.id === session.roleId;
  const locked = lockedPermissions({
    isProtected: role.is_protected,
    isOwnRole,
  });

  // Same rules the delete action enforces, so the page can explain a block
  // up front. The action re-checks, and the database has the last word.
  const deletePlan = planRoleDelete({
    role,
    userCount: role.user_count,
    actorRoleId: session.roleId,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/roles"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Roles
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit role: {role.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          {role.user_count === 1
            ? "1 user has this role."
            : `${role.user_count} users have this role.`}{" "}
          Changes apply on their next request.
        </p>
        {role.is_protected ? (
          <p className="text-muted-foreground text-sm">
            This role is protected. User and role management stay on.
          </p>
        ) : null}
      </div>
      <RoleForm
        key={role.id}
        groups={groupPermissions(permissions)}
        role={{
          id: role.id,
          name: role.name,
          description: role.description ?? "",
          keys: role.permission_keys,
        }}
        locked={locked}
      />

      <section
        aria-label="Delete role"
        className="space-y-3 rounded-md border border-red-200 p-4 dark:border-red-950"
      >
        <h2 className="text-lg font-semibold tracking-tight">Delete role</h2>
        <DeleteRoleButton
          roleId={role.id}
          roleName={role.name}
          blockedReason={deletePlan.ok ? null : deletePlan.error}
        />
      </section>
    </div>
  );
}
