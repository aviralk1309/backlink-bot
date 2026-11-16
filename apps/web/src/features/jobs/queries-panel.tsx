import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LiveStats } from "./live-stats";
import {
  QUERY_PAGE_SIZE,
  getJobLive,
  getJobQueryYield,
  listJobQueries,
} from "./queries";
import { RetryQueryButton } from "./retry-query-button";
import { formatCount, isPollingStatus } from "./stats";
import { EMPTY_JOB_STATS, type JobRow } from "./types";
import { QueryRefresh } from "./query-refresh";

const STATUS_LABELS = {
  pending: "Pending",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

function queryHref(id: string, page: number) {
  return `/jobs/${id}?tab=queries${page > 1 ? `&qpage=${page}` : ""}`;
}

export async function QueriesPanel({
  job,
  rawPage,
  canRetry,
}: {
  job: JobRow;
  rawPage: string | string[] | undefined;
  canRetry: boolean;
}) {
  const page =
    typeof rawPage === "string" && /^[1-9]\d{0,3}$/.test(rawPage)
      ? Number(rawPage)
      : 1;
  const [history, yieldRows, live] = await Promise.all([
    listJobQueries(job.id, page),
    getJobQueryYield(job.id),
    getJobLive(job.id),
  ]);
  const retryableJob =
    canRetry &&
    (["running", "paused", "saturated"].includes(job.status) ||
      (job.status === "completed" && job.status_reason === "drained") ||
      (job.status === "failed" && job.status_reason === "all_queries_failed"));
  const total = yieldRows.reduce((sum, row) => sum + row.queries_total, 0);
  const hasFailures = yieldRows.some((row) => row.queries_failed > 0);
  const lastPage = Math.max(1, Math.ceil(total / QUERY_PAGE_SIZE));
  if (page > lastPage) redirect(queryHref(job.id, lastPage));

  return (
    <section aria-label="Search queries" className="space-y-5">
      {isPollingStatus(job.status) ? <QueryRefresh /> : null}
      <div>
        <h2 className="text-lg font-semibold">Search queries</h2>
        <p className="text-muted-foreground text-sm">
          Search requests and the domains each one added. Retrying a failed
          request may spend more credits.
        </p>
      </div>
      <LiveStats
        key={job.status}
        jobId={job.id}
        status={job.status}
        budget={job.budget_credits}
        initial={live?.stats ?? EMPTY_JOB_STATS}
      />
      {hasFailures &&
      job.status === "completed" &&
      job.status_reason === "budget_reached" ? (
        <Notice tone="info">
          This job reached its credit budget. Failed queries cannot be retried.
        </Notice>
      ) : null}
      {hasFailures &&
      (job.status === "paused" || job.status === "saturated") ? (
        <Notice tone="info">Retries will wait until the job resumes.</Notice>
      ) : null}
      {yieldRows.length > 0 ? (
        <section
          className="bg-card space-y-3 rounded-xl border p-5"
          aria-label="Yield by template"
        >
          <h3 className="font-semibold">Yield by template</h3>
          {history.some(
            (row) =>
              row.status === "done" && row.accepted_result_count === null,
          ) ? (
            <p className="text-muted-foreground text-sm">
              Older queries have no valid/excluded breakdown; raw results can
              include search redirects.
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Template</TableHead>
                <TableHead scope="col">Done / total</TableHead>
                <TableHead scope="col">Failed</TableHead>
                <TableHead scope="col">Credits</TableHead>
                <TableHead scope="col">Raw results</TableHead>
                <TableHead scope="col">New domains</TableHead>
                <TableHead scope="col">Domains / credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yieldRows.map((row) => (
                <TableRow
                  key={`${row.activity_key}/${row.template_id}/${row.template_version}`}
                >
                  <TableCell className="font-medium">
                    {row.activity_key} / {row.template_id} v
                    {row.template_version}
                  </TableCell>
                  <TableCell>
                    {formatCount(row.queries_done)} /{" "}
                    {formatCount(row.queries_total)}
                  </TableCell>
                  <TableCell>{formatCount(row.queries_failed)}</TableCell>
                  <TableCell>{formatCount(row.credits_used)}</TableCell>
                  <TableCell>{formatCount(row.result_count)}</TableCell>
                  <TableCell>{formatCount(row.new_unique_domains)}</TableCell>
                  <TableCell>
                    {row.credits_used > 0
                      ? (row.new_unique_domains / row.credits_used).toFixed(2)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
      <section
        className="bg-card space-y-3 rounded-xl border p-5"
        aria-label="Query history"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-semibold">Query history</h3>
          <span className="text-muted-foreground text-sm">
            {formatCount(total)} queries
          </span>
        </div>
        {history.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Query</TableHead>
                <TableHead scope="col">Template</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Credits</TableHead>
                <TableHead scope="col">Raw results</TableHead>
                <TableHead scope="col">New domains</TableHead>
                <TableHead scope="col">Error / action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((row) => (
                <TableRow key={row.id}>
                  <TableCell
                    className="max-w-80 break-words whitespace-normal"
                    title={row.query_text}
                  >
                    {row.query_text}
                    {row.location ? (
                      <span className="text-muted-foreground block text-xs">
                        {row.location}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.activity_key} / {row.template_id} v
                    {row.template_version}
                    <span className="text-muted-foreground block text-xs">
                      Page {row.page} · {row.attempts} attempts
                    </span>
                  </TableCell>
                  <TableCell>{STATUS_LABELS[row.status]}</TableCell>
                  <TableCell>
                    {row.credits_used ?? "—"}
                    {row.credit_spend_uncertain ? (
                      <span className="text-muted-foreground block text-xs">
                        possibly charged
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.result_count ?? "—"}
                    {row.accepted_result_count !== null ? (
                      <span className="text-muted-foreground block text-xs">
                        {row.accepted_result_count} valid ·{" "}
                        {row.rejected_result_count} excluded ·{" "}
                        {row.duplicate_result_count} repeated
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.new_unique_domains ?? "—"}</TableCell>
                  <TableCell className="max-w-64 break-words whitespace-normal">
                    {row.error ? (
                      <span className="text-destructive block text-xs">
                        {row.error}
                      </span>
                    ) : null}
                    {row.status === "failed" && retryableJob ? (
                      <RetryQueryButton jobId={job.id} queryId={row.id} />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title="No search queries yet"
            description="Queries appear after a worker picks up this job."
          />
        )}
        {total > QUERY_PAGE_SIZE ? (
          <nav
            aria-label="Query pages"
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span>
              Page {page} of {lastPage}
            </span>
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={queryHref(job.id, page - 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Previous
                </Link>
              ) : null}
              {page < lastPage ? (
                <Link
                  href={queryHref(job.id, page + 1)}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </section>
    </section>
  );
}
