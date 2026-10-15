import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { BackLink } from "@/components/back-link";
import { buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CsvUploadsPanel } from "@/features/csv/csv-uploads-panel";
import { ActivityLog } from "@/features/jobs/activity-log";
import { DeleteJobButton, JobActions } from "@/features/jobs/job-actions";
import { JobSettings } from "@/features/jobs/job-settings";
import { JobTabs } from "@/features/jobs/job-tabs";
import { LocalTime } from "@/features/jobs/local-time";
import { savedNotice } from "@/features/jobs/notice";
import { LiveStats } from "@/features/jobs/live-stats";
import { EMPTY_JOB_STATS } from "@/features/jobs/types";
import {
  getJob,
  getJobEvents,
  getJobLive,
  getJobStartProblems,
  listActivityOptions,
} from "@/features/jobs/queries";
import {
  availableActions,
  isDeletable,
  isEditable,
  JOB_STATUS_LABELS,
  startProblemText,
} from "@/features/jobs/rules";
import { jobIdSchema } from "@/features/jobs/schemas";
import { StatusBadge } from "@/features/jobs/status-badge";
import type { JobRow } from "@/features/jobs/types";
import { activityNames, parseTab } from "@/features/jobs/view";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; saved?: string }>;
};

export default function JobPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobContent {...props} />
    </Suspense>
  );
}

async function JobContent({ params, searchParams }: Props) {
  const session = await requirePagePermission("jobs.view");

  const { id } = await params;
  if (!jobIdSchema.safeParse(id).success) notFound();

  const [raw, job, activities] = await Promise.all([
    searchParams,
    getJob(id),
    listActivityOptions(),
  ]);
  if (!job) notFound();

  const tab = parseTab(raw.tab);
  const notice = savedNotice(raw.saved);
  const permissions = session.permissions;
  const actions = availableActions(job.status, permissions);
  const canEdit = permissions.includes("jobs.edit") && isEditable(job.status);
  const canDelete = permissions.includes("jobs.delete");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/jobs">Jobs</BackLink>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight break-words">
              {job.name}
            </h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusBadge status={job.status} />
              {job.client ? <span>{job.client}</span> : null}
              {job.client_domain ? <span>{job.client_domain}</span> : null}
            </p>
          </div>
          {canEdit ? (
            <Link
              href={`/jobs/${job.id}/edit`}
              className={buttonVariants({ variant: "outline" })}
            >
              <Pencil aria-hidden data-icon="inline-start" />
              Edit settings
            </Link>
          ) : null}
        </div>
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        <JobActions
          jobId={job.id}
          status={job.status}
          budget={job.budget_credits}
          actions={actions}
        />
      </div>

      <JobTabs jobId={job.id} active={tab} />

      {tab === "overview" ? (
        <Overview job={job} activities={activities} />
      ) : null}
      {tab === "settings" ? (
        <JobSettings job={job} activities={activities} />
      ) : null}
      {tab === "data" ? (
        <CsvUploadsPanel
          jobId={job.id}
          isDraft={job.status === "draft"}
          canUpload={permissions.includes("csv.upload")}
        />
      ) : null}
      {tab === "activity" ? <Activity jobId={job.id} /> : null}

      {canDelete ? (
        <section
          aria-label="Delete job"
          className="border-destructive/30 bg-card space-y-3 rounded-xl border p-5"
        >
          <h2 className="text-base font-semibold tracking-tight">Delete job</h2>
          <DeleteJobButton
            jobId={job.id}
            jobName={job.name}
            blockedReason={
              isDeletable(job.status)
                ? null
                : "Stop this job before deleting it. Workers may still be using it."
            }
          />
        </section>
      ) : null}
    </div>
  );
}

async function Overview({
  job,
  activities,
}: {
  job: JobRow;
  activities: Awaited<ReturnType<typeof listActivityOptions>>;
}) {
  const [problems, live] = await Promise.all([
    job.status === "draft"
      ? getJobStartProblems(job.id)
      : Promise.resolve([] as string[]),
    getJobLive(job.id),
  ]);

  return (
    <div className="space-y-4">
      {job.status === "draft" ? (
        <section
          aria-label="Ready to start"
          className="bg-card space-y-3 rounded-xl border p-5"
        >
          <div className="flex items-center gap-2">
            {problems.length === 0 ? (
              <CheckCircle2 aria-hidden className="text-success size-5" />
            ) : (
              <AlertCircle aria-hidden className="text-warning size-5" />
            )}
            <h2 className="text-base font-semibold tracking-tight">
              {problems.length === 0
                ? "Ready to start"
                : "Before you can start"}
            </h2>
          </div>
          {problems.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Everything needed is filled in. Start the job when you are ready.
            </p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {problems.map((code) => (
                <li key={code}>{startProblemText(code)}</li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {job.status_reason &&
      (job.status === "failed" || job.status === "stopped") ? (
        <Notice tone={job.status === "failed" ? "error" : "info"} role="status">
          <span className="opacity-80">Reason: </span>
          {job.status_reason}
        </Notice>
      ) : null}

      <LiveStats
        key={job.status}
        jobId={job.id}
        status={job.status}
        budget={job.budget_credits}
        initial={live?.stats ?? EMPTY_JOB_STATS}
      />

      <section
        aria-label="Summary"
        className="bg-card space-y-4 rounded-xl border p-5"
      >
        <h2 className="text-base font-semibold tracking-tight">Summary</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[14rem_1fr]">
          <dt className="text-muted-foreground text-sm">Status</dt>
          <dd className="text-sm">{JOB_STATUS_LABELS[job.status]}</dd>
          <dt className="text-muted-foreground text-sm">Activities</dt>
          <dd className="text-sm">
            {job.activity_keys.length > 0
              ? activityNames(job.activity_keys, activities).join(", ")
              : "None chosen"}
          </dd>
          <dt className="text-muted-foreground text-sm">Settings version</dt>
          <dd className="text-sm">{job.config_version}</dd>
          <dt className="text-muted-foreground text-sm">Created</dt>
          <dd className="text-sm">
            <LocalTime iso={job.created_at} />
          </dd>
          {job.started_at ? (
            <>
              <dt className="text-muted-foreground text-sm">Started</dt>
              <dd className="text-sm">
                <LocalTime iso={job.started_at} />
              </dd>
            </>
          ) : null}
          {job.finished_at ? (
            <>
              <dt className="text-muted-foreground text-sm">Finished</dt>
              <dd className="text-sm">
                <LocalTime iso={job.finished_at} />
              </dd>
            </>
          ) : null}
        </dl>
      </section>
    </div>
  );
}

async function Activity({ jobId }: { jobId: string }) {
  const events = await getJobEvents(jobId);
  return <ActivityLog events={events} />;
}
