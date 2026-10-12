import Link from "next/link";
import { Suspense } from "react";
import { ActivityForm } from "@/features/activities/activity-form";
import { configToForm } from "@/features/activities/form-values";
import { defaultConfig } from "@/features/activities/rules";
import { requirePagePermission } from "@/lib/auth/guard";

export default function NewActivityPage() {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <NewActivityContent />
    </Suspense>
  );
}

async function NewActivityContent() {
  await requirePagePermission("activities.manage");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/admin/activities"
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Activities
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New activity</h1>
        <p className="text-muted-foreground text-sm">
          The starting values are safe defaults. Add search templates and the
          signals that fit this kind of backlink.
        </p>
      </div>
      <ActivityForm
        values={{
          id: null,
          key: "",
          name: "",
          enabled: true,
          updatedAt: "",
          version: null,
          config: configToForm(defaultConfig()),
        }}
      />
    </div>
  );
}
