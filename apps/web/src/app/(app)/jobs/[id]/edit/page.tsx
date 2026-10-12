import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";
import { BackLink } from "@/components/back-link";
import { buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { jobToFormValues } from "@/features/jobs/form-values";
import { JobForm } from "@/features/jobs/job-form";
import { getJob, listActivityOptions } from "@/features/jobs/queries";
import { isEditable, JOB_STATUS_LABELS } from "@/features/jobs/rules";
import { jobIdSchema } from "@/features/jobs/schemas";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = { params: Promise<{ id: string }> };

export default function EditJobPage({ params }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditJobContent params={params} />
    </Suspense>
  );
}

async function EditJobContent({ params }: Props) {
  await requirePagePermission("jobs.edit");

  const { id } = await params;
  // A malformed id is a missing page, not a database error.
  if (!jobIdSchema.safeParse(id).success) notFound();

  const [job, activities] = await Promise.all([
    getJob(id),
    listActivityOptions(),
  ]);
  if (!job) notFound();

  if (!isEditable(job.status)) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <BackLink href={`/jobs/${job.id}`}>{job.name}</BackLink>
          <h1 className="text-2xl font-semibold tracking-tight">
            Edit job: {job.name}
          </h1>
        </div>
        <Notice tone="info">
          This job is {JOB_STATUS_LABELS[job.status].toLowerCase()}, so its
          settings can no longer be changed. They stay as a record of what ran.
        </Notice>
        <Link
          href={`/jobs/${job.id}`}
          className={buttonVariants({ variant: "outline" })}
        >
          Back to the job
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink href={`/jobs/${job.id}`}>{job.name}</BackLink>
        <h1 className="text-2xl font-semibold tracking-tight">
          Edit job: {job.name}
        </h1>
        <p className="text-muted-foreground text-sm">
          Status: {JOB_STATUS_LABELS[job.status]}.
        </p>
      </div>
      <JobForm
        key={job.id}
        values={jobToFormValues(job)}
        activities={activities}
        status={job.status}
      />
    </div>
  );
}
