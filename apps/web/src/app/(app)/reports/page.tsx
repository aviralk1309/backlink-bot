import { Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";
import { listActivityOptions } from "@/features/jobs/queries";
import { ReportPanel } from "@/features/reports/report-panel";
import { listReportJobs } from "@/features/reports/queries";
import { requirePagePermission } from "@/lib/auth/guard";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ReportsPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReportsContent {...props} />
    </Suspense>
  );
}

async function ReportsContent({ searchParams }: Props) {
  await requirePagePermission("reports.view");
  const [raw, jobs, activities] = await Promise.all([
    searchParams,
    listReportJobs(),
    listActivityOptions(),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Review decisions and approval rates across jobs.
        </p>
      </div>
      <ReportPanel raw={raw} jobs={jobs} activities={activities} />
    </div>
  );
}
