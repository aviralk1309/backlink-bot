import { format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
} from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { Can } from "@/components/can";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { savedNotice } from "@/features/jobs/notice";
import { StatusBadge } from "@/features/jobs/status-badge";
import {
  getJobStatusCounts,
  listActivityOptions,
  listJobs,
} from "@/features/jobs/queries";
import {
  JOB_STATUS_LABELS,
  PAGE_SIZE,
  parseListParams,
} from "@/features/jobs/rules";
import { JOB_STATUSES } from "@/features/jobs/types";
import { activityNames, buildListHref, pageRange } from "@/features/jobs/view";
import { requirePagePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";

type Props = {
  searchParams: Promise<{
    status?: string;
    q?: string;
    page?: string;
    saved?: string;
  }>;
};

export default function JobsPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <JobsContent searchParams={searchParams} />
    </Suspense>
  );
}

const tabClass = (active: boolean) =>
  cn(
    "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11",
    active
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

const newJobLink = (
  <Can permission="jobs.create">
    <Link href="/jobs/new" className={buttonVariants()}>
      <Plus aria-hidden data-icon="inline-start" />
      New job
    </Link>
  </Can>
);

async function JobsContent({ searchParams }: Props) {
  await requirePagePermission("jobs.view");

  const raw = await searchParams;
  const params = parseListParams(raw);
  const notice = savedNotice(raw.saved);

  const [{ rows, total }, counts, activities] = await Promise.all([
    listJobs(params),
    getJobStatusCounts(),
    listActivityOptions(),
  ]);

  // A link to a page that no longer exists (jobs were deleted) goes to the last one.
  if (rows.length === 0 && total > 0 && params.page > 1) {
    const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
    redirect(buildListHref({ ...params, page: last }));
  }

  const range = pageRange(params.page, total);
  const filtered = params.status !== null || params.q !== "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-muted-foreground text-sm">
            Each job finds backlink opportunities for one client.
          </p>
        </div>
        {newJobLink}
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav
          aria-label="Filter by status"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1"
        >
          <Link
            href={buildListHref({ q: params.q })}
            aria-current={params.status === null ? "page" : undefined}
            className={tabClass(params.status === null)}
          >
            All
            <span className="text-muted-foreground text-xs">
              {counts.all ?? 0}
            </span>
          </Link>
          {JOB_STATUSES.map((s) => (
            <Link
              key={s}
              href={buildListHref({ status: s, q: params.q })}
              aria-current={params.status === s ? "page" : undefined}
              className={tabClass(params.status === s)}
            >
              {JOB_STATUS_LABELS[s]}
              <span className="text-muted-foreground text-xs">
                {counts[s] ?? 0}
              </span>
            </Link>
          ))}
        </nav>

        <form
          action="/jobs"
          method="get"
          role="search"
          className="flex w-full items-center gap-2 lg:max-w-md"
        >
          {params.status ? (
            <input type="hidden" name="status" value={params.status} />
          ) : null}
          <div className="relative flex-1">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              name="q"
              defaultValue={params.q}
              aria-label="Search jobs"
              placeholder="Search name, client or domain"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
          {filtered ? (
            <Link href="/jobs" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Briefcase />}
          title={filtered ? "No jobs match" : "No jobs yet"}
          description={
            filtered
              ? "No jobs match these filters."
              : "No jobs yet. Create the first one to get started."
          }
          action={filtered ? undefined : newJobLink}
        />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Job</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Activities</TableHead>
                <TableHead scope="col">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => {
                const names = activityNames(job.activity_keys, activities);
                return (
                  <TableRow key={job.id} className="align-top">
                    <TableCell className="px-4 py-3 whitespace-normal">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="focus-visible:ring-ring rounded font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                      >
                        {job.name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {[job.client, job.client_domain]
                          .filter(Boolean)
                          .join(" · ") || "No client yet"}
                      </p>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 py-3 whitespace-normal">
                      {names.length > 0 ? names.join(", ") : "None"}
                    </TableCell>
                    <TableCell className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                      {format(new Date(job.updated_at), "d MMM yyyy")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Showing {range.from}–{range.to} of {total}
          </p>
          <nav aria-label="Pagination" className="flex items-center gap-2">
            {range.hasPrev ? (
              <Link
                href={buildListHref({ ...params, page: params.page - 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                <ChevronLeft aria-hidden data-icon="inline-start" />
                Previous
              </Link>
            ) : null}
            {range.hasNext ? (
              <Link
                href={buildListHref({ ...params, page: params.page + 1 })}
                className={buttonVariants({ variant: "outline" })}
              >
                Next
                <ChevronRight aria-hidden data-icon="inline-end" />
              </Link>
            ) : null}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
