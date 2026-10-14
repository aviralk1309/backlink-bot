import { Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";
import { BackLink } from "@/components/back-link";
import { ActivityForm } from "@/features/activities/activity-form";
import { configToForm } from "@/features/activities/form-values";
import { defaultConfig } from "@/features/activities/rules";
import { requirePagePermission } from "@/lib/auth/guard";

export default function NewActivityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewActivityContent />
    </Suspense>
  );
}

async function NewActivityContent() {
  await requirePagePermission("activities.manage");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href="/admin/activities">Activities</BackLink>
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
