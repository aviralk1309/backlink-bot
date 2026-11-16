import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CircleCheck,
  ClipboardCheck,
  Plus,
  Sparkles,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { PageSkeleton } from "@/components/app-skeletons";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { LocalTime } from "@/features/jobs/local-time";
import { getJobStatusCounts, listJobs } from "@/features/jobs/queries";
import { StatusBadge } from "@/features/jobs/status-badge";
import { getPendingReviewCount } from "@/features/results/queries";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const session = await getSession();
  if (!session) redirect("/login");

  const canViewJobs = session.permissions.includes("jobs.view");
  const canCreateJobs = session.permissions.includes("jobs.create");
  const canViewResults =
    canViewJobs && session.permissions.includes("results.view");
  const canViewReports = session.permissions.includes("reports.view");
  const canManageAdmin = session.permissions.some((permission) =>
    [
      "users.manage",
      "roles.manage",
      "activities.manage",
      "blocklist.manage",
    ].includes(permission),
  );

  const [jobs, counts, pendingReviews] = await Promise.all([
    canViewJobs
      ? listJobs({ page: 1, status: null, q: "" })
      : Promise.resolve(null),
    canViewJobs ? getJobStatusCounts() : Promise.resolve(null),
    canViewResults ? getPendingReviewCount() : Promise.resolve(null),
  ]);

  const firstName =
    session.fullName.trim().split(/\s+/)[0] || session.email.split("@")[0];
  const activeJobs = (counts?.queued ?? 0) + (counts?.running ?? 0);
  const recentJobs = jobs?.rows.slice(0, 5) ?? [];
  const quickLinks = [
    ...(canViewJobs
      ? [{ href: "/jobs", label: "View all jobs", icon: BriefcaseBusiness }]
      : []),
    ...(canViewResults
      ? [
          {
            href: "/jobs",
            label: "Open jobs and review results",
            icon: ClipboardCheck,
          },
        ]
      : []),
    ...(canViewReports
      ? [{ href: "/reports", label: "Open reports", icon: BarChart3 }]
      : []),
    ...(canManageAdmin
      ? [{ href: "/admin", label: "Manage workspace", icon: UsersRound }]
      : []),
  ];

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-primary flex items-center gap-2 text-sm font-medium">
            <Sparkles aria-hidden className="size-4" />
            Backlink workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Find promising backlink prospects, keep jobs moving, and focus your
            team on the opportunities that need a decision.
          </p>
        </div>
        {canCreateJobs ? (
          <Link href="/jobs/new" className={buttonVariants()}>
            <Plus aria-hidden data-icon="inline-start" />
            Create job
          </Link>
        ) : null}
      </section>

      {canViewJobs ? (
        <section
          aria-label="Workspace overview"
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          <MetricCard
            label="Total jobs"
            value={jobs?.total ?? 0}
            detail="Across your workspace"
            icon={BriefcaseBusiness}
          />
          <MetricCard
            label="In progress"
            value={activeJobs}
            detail={`${counts?.queued ?? 0} queued · ${counts?.running ?? 0} running`}
            icon={Sparkles}
          />
          {canViewResults ? (
            <MetricCard
              label="Ready for review"
              value={pendingReviews ?? 0}
              detail="Prospects waiting in the Ready queue"
              icon={ClipboardCheck}
              href="/jobs"
            />
          ) : null}
          <MetricCard
            label="Completed"
            value={counts?.completed ?? 0}
            detail="Jobs finished successfully"
            icon={CircleCheck}
          />
        </section>
      ) : null}

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
            <div className="space-y-1">
              <CardTitle>Recent jobs</CardTitle>
              <CardDescription>
                The latest work across your backlink campaigns.
              </CardDescription>
            </div>
            {canViewJobs ? (
              <Link
                href="/jobs"
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                All jobs <ArrowRight aria-hidden data-icon="inline-end" />
              </Link>
            ) : null}
          </CardHeader>
          <CardContent className="pt-2">
            {!canViewJobs ? (
              <EmptyState
                title="Jobs aren’t available for this role"
                description="Use one of the workspace links to continue, or ask an admin to update your access."
                className="border-0 py-10"
              />
            ) : recentJobs.length === 0 ? (
              <EmptyState
                icon={<BriefcaseBusiness />}
                title="Your workspace is ready"
                description="Create a job to start finding backlink opportunities for a client."
                action={
                  canCreateJobs ? (
                    <Link href="/jobs/new" className={buttonVariants()}>
                      <Plus aria-hidden data-icon="inline-start" />
                      Create your first job
                    </Link>
                  ) : undefined
                }
                className="border-0 py-10"
              />
            ) : (
              <ul className="divide-y">
                {recentJobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="focus-visible:ring-ring flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-4 outline-none focus-visible:ring-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {job.name}
                        </span>
                        <span className="text-muted-foreground mt-1 block truncate text-xs">
                          {[job.client, job.client_domain]
                            .filter(Boolean)
                            .join(" · ") || "No client details"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={job.status} />
                        <LocalTime
                          iso={job.updated_at}
                          className="text-muted-foreground hidden text-xs sm:inline"
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
              <CardDescription>Go straight to your next task.</CardDescription>
            </CardHeader>
            <CardContent>
              {quickLinks.length ? (
                <ul className="space-y-1">
                  {quickLinks.map(({ href, label, icon: Icon }) => (
                    <li key={href + label}>
                      <Link
                        href={href}
                        className={cn(
                          buttonVariants({ variant: "ghost" }),
                          "w-full justify-start",
                        )}
                      >
                        <Icon aria-hidden data-icon="inline-start" />
                        {label}
                        <ArrowRight
                          aria-hidden
                          className="text-muted-foreground ml-auto size-4"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Your account has no workspace sections yet. Ask an admin to
                  grant access.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  detail: string;
  icon: LucideIcon;
  href?: string;
}) {
  const content = (
    <Card className={href ? "hover:border-primary/40 transition-colors" : ""}>
      <CardContent className="flex items-start justify-between gap-3 pt-5">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="text-3xl font-semibold tracking-tight tabular-nums">
            {value.toLocaleString()}
          </p>
          <p className="text-muted-foreground text-xs">{detail}</p>
        </div>
        <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
          <Icon aria-hidden className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link
      href={href}
      className="focus-visible:ring-ring block rounded-xl outline-none focus-visible:ring-2"
    >
      {content}
    </Link>
  ) : (
    content
  );
}
