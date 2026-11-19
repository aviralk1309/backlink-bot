import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActivityOption } from "@/features/jobs/types";
import { ReportCharts } from "./charts";
import { parseReportFilters, reportExportHref } from "./filters";
import { loadReport, type MetricRow } from "./queries";

const SECTIONS = [
  ["source", "Sources", "Source"],
  ["query_template", "Query templates", "Query template"],
  ["activity", "Activities", "Activity"],
  ["tier", "Score tiers", "Score tier"],
] as const;

function rate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function MetricTable({
  title,
  label,
  rows,
  names,
}: {
  title: string;
  label: string;
  rows: MetricRow[];
  names: Map<string, string>;
}) {
  return (
    <section className="bg-card rounded-xl border p-4">
      <h3 className="mb-2 font-medium">{title}</h3>
      {rows.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{label}</TableHead>
              <TableHead scope="col">Approved</TableHead>
              <TableHead scope="col">Used</TableHead>
              <TableHead scope="col">Rejected</TableHead>
              <TableHead scope="col">Undecided</TableHead>
              <TableHead scope="col">Approval rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.dimension}:${row.dimension_key ?? ""}`}>
                <TableCell className="font-medium">
                  {names.get(row.dimension_key ?? "") ??
                    row.dimension_key?.replaceAll("_", " ") ??
                    "Unassigned"}
                </TableCell>
                <TableCell>{row.approved_count}</TableCell>
                <TableCell>{row.used_count}</TableCell>
                <TableCell>{row.rejected_count}</TableCell>
                <TableCell>{row.undecided_count}</TableCell>
                <TableCell>
                  {rate(row.approval_rate)}
                  {row.low_sample ? (
                    <span className="text-muted-foreground ml-1 text-xs">
                      (small sample)
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-muted-foreground text-sm">
          No rows for this filter.
        </p>
      )}
    </section>
  );
}

export async function ReportPanel({
  raw,
  fixedJob,
  activities,
  jobs = [],
}: {
  raw: Record<string, string | string[] | undefined>;
  fixedJob?: string;
  activities: ActivityOption[];
  jobs?: { id: string; name: string }[];
}) {
  const filters = parseReportFilters(raw, fixedJob);
  if (!filters)
    return (
      <Notice tone="error">
        Invalid report filters.{" "}
        <Link href={fixedJob ? `/jobs/${fixedJob}?tab=report` : "/reports"}>
          Clear filters
        </Link>
      </Notice>
    );

  const { metrics, reasons, throughput, delivery } = await loadReport(filters);
  const top = metrics.find((row) => row.dimension === "top_50");
  const all = metrics.find((row) => row.dimension === "all_results");
  const names = new Map(
    activities.map((activity) => [activity.key, activity.name]),
  );
  const sources = metrics.filter((row) => row.dimension === "source");
  const base = fixedJob ? `/jobs/${fixedJob}?tab=report` : "/reports";

  return (
    <section aria-label="Report" className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-card rounded-xl border p-5 sm:col-span-2">
          <p className="text-muted-foreground text-sm">First-Ready approval rate</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums">
            {rate(top?.approval_rate ?? null)}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {top?.approved_count ?? 0} approved + {top?.used_count ?? 0} used /{" "}
            {top?.decided_count ?? 0} decided
          </p>
          {top?.low_sample ? (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              Small sample: fewer than 20 decisions.
            </p>
          ) : null}
        </div>
        <div className="bg-card rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">
            All results approval rate
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {rate(all?.approval_rate ?? null)}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {all?.decided_count ?? 0} decided
          </p>
        </div>
        <div className="bg-card rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">Undecided now</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {all?.undecided_count ?? 0}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Ready and Backlog
          </p>
        </div>
      </div>

      <form
        method="get"
        action={fixedJob ? `/jobs/${fixedJob}` : "/reports"}
        className="bg-card grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        {fixedJob ? (
          <input type="hidden" name="tab" value="report" />
        ) : (
          <label className="space-y-1 text-sm">
            <span>Job</span>
            <NativeSelect name="job" defaultValue={filters.job ?? ""}>
              <option value="">All jobs</option>
              {filters.job && !jobs.some((job) => job.id === filters.job) ? (
                <option value={filters.job}>
                  Selected job ({filters.job})
                </option>
              ) : null}
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <label className="space-y-1 text-sm">
          <span>From (UTC)</span>
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label className="space-y-1 text-sm">
          <span>To (UTC)</span>
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Activity</span>
          <NativeSelect name="activity" defaultValue={filters.activity ?? ""}>
            <option value="">All activities</option>
            {activities.map((activity) => (
              <option key={activity.key} value={activity.key}>
                {activity.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex items-end gap-2">
          <Button type="submit">Apply</Button>
          <Link href={base} className={buttonVariants({ variant: "outline" })}>
            Clear
          </Link>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Dates filter latest decisions. Undecided is the current count.
        </p>
        <Link
          href={reportExportHref(filters)}
          className={buttonVariants({ variant: "outline" })}
        >
          <Download aria-hidden data-icon="inline-start" /> Download report CSV
        </Link>
      </div>

      <ReportCharts sources={sources} throughput={throughput} />

      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-2 font-medium">Backlinks delivered (all time)</h3>
        <p className="text-muted-foreground mb-3 text-sm">
          Current link checks; search credits are counted once per paid query. A
          blocked or timed-out page is unknown, not a verified link.
        </p>
        {delivery.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Group</TableHead>
                <TableHead scope="col">Value</TableHead>
                <TableHead scope="col">Submitted</TableHead>
                <TableHead scope="col">Verified</TableHead>
                <TableHead scope="col">Missing</TableHead>
                <TableHead scope="col">Unknown</TableHead>
                <TableHead scope="col">Credits</TableHead>
                <TableHead scope="col">Credits / verified</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delivery.map((row) => (
                <TableRow key={`${row.dimension}:${row.dimension_key}`}>
                  <TableCell>{row.dimension.replaceAll("_", " ")}</TableCell>
                  <TableCell className="max-w-xs break-all">
                    {names.get(row.dimension_key ?? "") ??
                      row.dimension_key ??
                      "—"}
                  </TableCell>
                  <TableCell>{row.submitted_count}</TableCell>
                  <TableCell>{row.verified_count}</TableCell>
                  <TableCell>{row.unverified_count}</TableCell>
                  <TableCell>{row.unknown_count}</TableCell>
                  <TableCell>{row.credits_used}</TableCell>
                  <TableCell>{row.credits_per_verified ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            No submitted links or paid queries for this filter.
          </p>
        )}
      </section>

      {SECTIONS.map(([dimension, title, label]) => (
        <MetricTable
          key={dimension}
          title={title}
          label={label}
          rows={metrics.filter((row) => row.dimension === dimension)}
          names={names}
        />
      ))}

      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-2 font-medium">Reject reasons</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Reason</TableHead>
              <TableHead scope="col">Rejected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reasons.map((row) => (
              <TableRow key={row.reject_reason}>
                <TableCell>{row.reject_reason.replaceAll("_", " ")}</TableCell>
                <TableCell>{row.rejected_count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="bg-card rounded-xl border p-4">
        <h3 className="mb-2 font-medium">Review throughput by UTC day</h3>
        {throughput.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Day</TableHead>
                <TableHead scope="col">Approved</TableHead>
                <TableHead scope="col">Rejected</TableHead>
                <TableHead scope="col">Decisions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {throughput.map((row) => (
                <TableRow key={row.day}>
                  <TableCell>{row.day}</TableCell>
                  <TableCell>{row.approved_count}</TableCell>
                  <TableCell>{row.rejected_count}</TableCell>
                  <TableCell>{row.decided_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">
            No decisions in this period.
          </p>
        )}
      </section>
    </section>
  );
}
