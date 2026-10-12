import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { Notice } from "@/components/ui/notice";
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
    <Suspense fallback={<PageSkeleton />}>
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
      <div className="space-y-2">
        <Link
          href="/admin/roles"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded text-sm outline-none focus-visible:ring-2"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Roles
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
          <Notice tone="info">
            This role is protected. User and role management stay on.
          </Notice>
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
        className="border-destructive/30 bg-card space-y-3 rounded-xl border p-5"
      >
        <h2 className="text-base font-semibold tracking-tight">Delete role</h2>
        <DeleteRoleButton
          roleId={role.id}
          roleName={role.name}
          blockedReason={deletePlan.ok ? null : deletePlan.error}
        />
      </section>
    </div>
  );
}
