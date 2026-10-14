import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";
import { BackLink } from "@/components/back-link";
import { ActivityForm } from "@/features/activities/activity-form";
import { profileToFormValues } from "@/features/activities/form-values";
import { getActivityProfile } from "@/features/activities/queries";
import { activityIdSchema } from "@/features/activities/schemas";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { params: Promise<{ id: string }> };

export default function EditActivityPage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditActivityContent params={params} />
    </Suspense>
  );
}

async function EditActivityContent({ params }: Props) {
  await requirePagePermission("activities.manage");

  const { id } = await params;
  // A malformed id is a missing page, not a database error.
  if (!activityIdSchema.safeParse(id).success) notFound();

  const activity = await getActivityProfile(id);
  if (!activity) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href="/admin/activities">Activities</BackLink>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit activity: {activity.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          Scores remember which version of an activity produced them, so earlier
          results stay explainable after you change it.
        </p>
      </div>
      <ActivityForm
        key={`${activity.id}:${activity.updated_at}`}
        values={profileToFormValues(activity)}
      />
    </div>
  );
}
