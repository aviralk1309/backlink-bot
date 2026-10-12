import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { emptyJobFormValues } from "@/features/jobs/form-values";
import { JobForm } from "@/features/jobs/job-form";
import { listActivityOptions } from "@/features/jobs/queries";
import { requirePagePermission } from "@/lib/auth/guard";

export default function NewJobPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewJobContent />
    </Suspense>
  );
}

async function NewJobContent() {
  await requirePagePermission("jobs.create");
  const activities = await listActivityOptions();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded text-sm outline-none focus-visible:ring-2"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Jobs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New job</h1>
        <p className="text-muted-foreground text-sm">
          Fill in what you know. You can save a draft and finish later. Nothing
          runs until you start the job.
        </p>
      </div>
      <JobForm
        values={emptyJobFormValues()}
        activities={activities}
        status={null}
      />
    </div>
  );
}
