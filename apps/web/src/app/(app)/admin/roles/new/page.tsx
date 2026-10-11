import Link from "next/link";
import { Suspense } from "react";
import { getRoleDetail, listPermissions } from "@/features/roles/queries";
import { RoleForm, type RoleFormValues } from "@/features/roles/role-form";
import { cloneName, groupPermissions } from "@/features/roles/rules";
import { requirePagePermission } from "@/lib/auth/guard";
type Props = { searchParams: Promise<{ from?: string }> };

export default function NewRolePage({ searchParams }: Props) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <NewRoleContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRoleContent({ searchParams }: Props) {
  await requirePagePermission("roles.manage");

  const [permissions, params] = await Promise.all([
    listPermissions(),
    searchParams,
  ]);

  let values: RoleFormValues = {
    id: null,
    name: "",
    description: "",
    keys: [],
  };
  let clonedFrom: string | null = null;

  if (params.from) {
    const source = await getRoleDetail(params.from);
    if (source) {
      clonedFrom = source.name;
      values = {
        id: null,
        name: cloneName(source.name),
        description: source.description ?? "",
        keys: source.permission_keys,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/roles"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Roles
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New role</h1>
        <p className="text-muted-foreground text-sm">
          {clonedFrom
            ? `Starting from ${clonedFrom}. Nothing is saved until you press Save.`
            : "Name the role and choose what it can do."}
        </p>
      </div>
      <RoleForm
        key={params.from ?? "new"}
        groups={groupPermissions(permissions)}
        role={values}
        locked={{}}
      />
    </div>
  );
}
