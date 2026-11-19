import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BlockFromReview } from "@/features/blocklist/review-block";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
import { cn } from "@/lib/utils";
import { EXPORT_COLUMNS } from "./export";
import {
  getResultDetail,
  isDomainSpam,
  listResultDomains,
  listResultRows,
  type ResultRow,
} from "./queries";
import { ResultDetailDrawer } from "./result-detail-drawer";
import { BulkReviewForm } from "./bulk-review-form";
import {
  FLAGS,
  QUEUES,
  REVIEW_STATUSES,
  SOURCES,
  TIERS,
  detailId,
  parseResultsParams,
  resultsHref,
  topReasons,
} from "./view";

const QUEUE_LABELS = {
  ready: "Ready for review",
  backlog: "Backlog",
  auto_filtered: "Auto-filtered",
  all: "All",
};
const STATUS_LABELS = {
  new: "New",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  used: "Used",
};
const SOURCE_LABELS = {
  competitor_csv: "Competitor CSV",
  seed_list: "Seed list",
  google: "Google",
  site_crawl: "Site crawl",
};
const FLAG_LABELS = {
  client_unknown: "Client link unknown",
  previous_spam: "Previously spam",
  previous_off_topic: "Previously off-topic for this niche",
  already_links: "Already links to client",
  domain_cap: "Domain cap",
};

export async function ResultsPanel({
  jobId,
  raw,
  activities,
  canViewFiltered,
  canReview,
  canReopen,
  canExport,
  canManageBlocklist,
}: {
  jobId: string;
  raw: Record<string, string | string[] | undefined>;
  activities: ActivityOption[];
  canViewFiltered: boolean;
  canReview: boolean;
  canReopen: boolean;
  canExport: boolean;
  canManageBlocklist: boolean;
}) {
  const p = parseResultsParams(raw);
  if (p.queue === "auto_filtered" && !canViewFiltered) forbidden();
  const selectedId = detailId(raw);
  const detail = selectedId ? await getResultDetail(jobId, selectedId) : null;
  if (selectedId && !detail) notFound();
  const page = p.group
    ? await listResultDomains(jobId, p)
    : await listResultRows(jobId, p);
  const resultRows = p.group ? [] : (page.rows as ResultRow[]);
  const domainSpam =
    p.domain && canReview ? await isDomainSpam(p.domain) : false;
  const selectedIndex = detail
    ? resultRows.findIndex((row) => row.id === detail.id)
    : -1;
  // shortcut: next-item navigation ends at a 50-row page boundary; the existing Next 50 link continues the queue.
  const nextId =
    selectedIndex >= 0 ? resultRows[selectedIndex + 1]?.id : undefined;
  const next = page.rows.at(-1);
  const nextCursor = next ? ("id" in next ? next.id : next.domain) : null;
  const activityNames = new Map(activities.map((a) => [a.key, a.name]));
  const filtered = Boolean(
    p.tier || p.activity || p.source || p.status || p.domain || p.q || p.flag,
  );

  return (
    <section aria-label="Results" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Results</h2>
        <p className="text-muted-foreground text-sm">
          Review Ready results. Later results wait in Backlog when Ready is
          full.
        </p>
      </div>

      <nav
        aria-label="Result queues"
        className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1"
      >
        {QUEUES.filter(
          (queue) => queue !== "auto_filtered" || canViewFiltered,
        ).map((queue) => (
          <Link
            key={queue}
            href={resultsHref(jobId, p, { queue, cursor: null })}
            aria-current={p.queue === queue ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 pointer-coarse:h-11",
              p.queue === queue
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {QUEUE_LABELS[queue]}
          </Link>
        ))}
      </nav>

      <form
        key={resultsHref(jobId, p)}
        action={`/jobs/${jobId}`}
        method="get"
        className="bg-card space-y-3 rounded-xl border p-4"
      >
        <input type="hidden" name="tab" value="results" />
        <input type="hidden" name="queue" value={p.queue} />
        {p.group ? <input type="hidden" name="group" value="domain" /> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span>Search URL or domain</span>
            <Input
              name="q"
              defaultValue={p.q ?? ""}
              maxLength={100}
              placeholder="Search results"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Domain</span>
            <Input
              name="domain"
              defaultValue={p.domain ?? ""}
              maxLength={253}
              placeholder="example.com"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span>Tier</span>
            <NativeSelect name="tier" defaultValue={p.tier ?? ""}>
              <option value="">All tiers</option>
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tierLabel(tier)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-sm">
            <span>Activity</span>
            <NativeSelect name="activity" defaultValue={p.activity ?? ""}>
              <option value="">All activities</option>
              {activities.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
              {p.activity && !activityNames.has(p.activity) ? (
                <option value={p.activity}>{p.activity}</option>
              ) : null}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-sm">
            <span>Source</span>
            <NativeSelect name="source" defaultValue={p.source ?? ""}>
              <option value="">All sources</option>
              {SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-sm">
            <span>Review status</span>
            <NativeSelect name="status" defaultValue={p.status ?? ""}>
              <option value="">All statuses</option>
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1 text-sm">
            <span>Flag</span>
            <NativeSelect name="flag" defaultValue={p.flag ?? ""}>
              <option value="">All flags</option>
              {FLAGS.map((flag) => (
                <option key={flag} value={flag}>
                  {FLAG_LABELS[flag]}
                </option>
              ))}
            </NativeSelect>
          </label>
          {!p.group ? (
            <label className="space-y-1 text-sm">
              <span>Sort</span>
              <NativeSelect name="sort" defaultValue={p.sort}>
                <option value="score">Highest score</option>
                <option value="newest">Newest first</option>
              </NativeSelect>
            </label>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit">Apply filters</Button>
          {filtered ? (
            <Link
              className={buttonVariants({ variant: "ghost" })}
              href={resultsHref(jobId, {
                ...p,
                tier: null,
                activity: null,
                source: null,
                status: null,
                domain: null,
                q: null,
                flag: null,
                cursor: null,
              })}
            >
              Clear filters
            </Link>
          ) : null}
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={resultsHref(jobId, p, { group: !p.group, cursor: null })}
          >
            {p.group ? "Show rows" : "Group by domain"}
          </Link>
        </div>
      </form>

      {canExport ? (
        <details className="bg-card rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">Export CSV</summary>
          <form
            action={`/api/jobs/${jobId}/results/export`}
            method="post"
            className="mt-4 space-y-4"
          >
            <input type="hidden" name="queue" value={p.queue} />
            {(
              [
                "tier",
                "activity",
                "source",
                "status",
                "domain",
                "q",
                "flag",
              ] as const
            ).map((key) => (
              <input key={key} type="hidden" name={key} value={p[key] ?? ""} />
            ))}
            <label className="block max-w-xs space-y-1 text-sm">
              <span>Review status</span>
              <NativeSelect name="export_status" defaultValue="current">
                <option value="current">Current filter</option>
                {REVIEW_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Columns</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {EXPORT_COLUMNS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="column"
                      value={key}
                      defaultChecked
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-muted-foreground text-xs">
              Current filter exports matching rows beyond this page. A chosen
              status exports that status across all visible queues.
            </p>
            <Button type="submit" variant="outline">
              Download CSV
            </Button>
          </form>
        </details>
      ) : null}

      {page.rows.length === 0 ? (
        <EmptyState
          title={
            p.cursor
              ? "No more results"
              : filtered
                ? "No results match"
                : `No ${QUEUE_LABELS[p.queue].toLowerCase()} results yet`
          }
          description={
            p.cursor
              ? "Return to the first page."
              : "Try another queue or change the filters."
          }
        />
      ) : p.group ? (
        <div className="space-y-2">
          {(
            page.rows as Awaited<ReturnType<typeof listResultDomains>>["rows"]
          ).map((group) => (
            <details
              key={group.domain}
              className="bg-card rounded-xl border p-4"
            >
              <summary className="focus-visible:ring-ring flex cursor-pointer flex-wrap items-center gap-3 rounded outline-none focus-visible:ring-2">
                <span className="font-medium">{group.domain}</span>
                <Badge variant="secondary">{group.result_count} URLs</Badge>
                <span className="text-muted-foreground text-sm">
                  Best score {scoreLabel(group.best_score)}
                </span>
              </summary>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {group.preview_urls.map((url) => (
                  <li key={url} className="break-all">
                    {url}
                  </li>
                ))}
              </ul>
              <Link
                href={resultsHref(jobId, p, {
                  domain: group.domain,
                  group: false,
                  cursor: null,
                })}
                className="text-primary mt-3 inline-block text-sm underline-offset-4 hover:underline"
              >
                View all URLs in this domain
              </Link>
              {canManageBlocklist && p.status === "rejected" ? (
                <div className="mt-3">
                  <BlockFromReview
                    jobId={jobId}
                    domain={group.domain}
                    defaultReason="Rejected result in this job"
                  />
                </div>
              ) : null}
            </details>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {canReview &&
          resultRows.some(
            (row) =>
              row.review_status === "in_review" &&
              (row.score === null || row.score_breakdown === null),
          ) ? (
            <Notice tone="info">
              Results without scoring data cannot be decided and are omitted
              from bulk review.
            </Notice>
          ) : null}
          {domainSpam && p.status === "in_review" ? (
            <Notice tone="info">
              This domain is globally flagged as spam. Select the In review URLs
              below to bulk reject them with the Spam reason.
            </Notice>
          ) : null}
          <div className="bg-card rounded-xl border">
            <BulkReviewForm
              key={resultRows
                .map((row) => `${row.id}:${row.row_version}`)
                .join(",")}
              jobId={jobId}
              enabled={canReview}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    {canReview ? (
                      <TableHead scope="col">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="select_all"
                            disabled={
                              !resultRows.some(
                                (row) =>
                                  row.review_status === "in_review" &&
                                  row.score !== null &&
                                  row.score_breakdown !== null,
                              )
                            }
                            aria-label="Select all In review results on this page"
                            className="accent-primary size-4"
                          />
                          <span className="sr-only">Select</span>
                        </label>
                      </TableHead>
                    ) : null}
                    {[
                      "URL",
                      "Domain",
                      "Score / tier",
                      "Top reasons",
                      "Sources",
                      "Overlap",
                      "Activity",
                      "Review",
                      "Flags",
                    ].map((heading) => (
                      <TableHead key={heading} scope="col">
                        {heading}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resultRows.map((row) => (
                    <ResultTableRow
                      key={row.id}
                      row={row}
                      canReview={canReview}
                      detailHref={resultsHref(jobId, p, { detail: row.id })}
                      activityName={
                        row.activity_key
                          ? (activityNames.get(row.activity_key) ??
                            row.activity_key)
                          : null
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </BulkReviewForm>
          </div>
        </div>
      )}

      <nav
        aria-label="Results pagination"
        className="flex flex-wrap items-center gap-2"
      >
        {p.cursor ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={resultsHref(jobId, p, { cursor: null })}
          >
            First page
          </Link>
        ) : null}
        {page.hasMore && nextCursor ? (
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={resultsHref(jobId, p, { cursor: nextCursor })}
          >
            Next 50
          </Link>
        ) : null}
      </nav>
      {detail ? (
        <ResultDetailDrawer
          detail={detail}
          jobId={jobId}
          closeHref={resultsHref(jobId, p)}
          nextHref={nextId ? resultsHref(jobId, p, { detail: nextId }) : null}
          domainReviewHref={resultsHref(jobId, p, {
            queue: "all",
            domain: detail.domain,
            status: "in_review",
            tier: null,
            activity: null,
            source: null,
            q: null,
            flag: null,
            group: false,
            cursor: null,
          })}
          canReview={canReview}
          canReopen={canReopen}
          canManageBlocklist={canManageBlocklist}
        />
      ) : null}
    </section>
  );
}

function tierLabel(tier: string | null) {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "—";
}

function scoreLabel(score: number | null) {
  return score === null ? "—" : score.toFixed(1);
}

function flag(flags: ResultRow["flags"], key: string) {
  return (
    flags &&
    typeof flags === "object" &&
    !Array.isArray(flags) &&
    flags[key] === true
  );
}

function ResultTableRow({
  row,
  activityName,
  detailHref,
  canReview,
}: {
  row: ResultRow;
  activityName: string | null;
  detailHref: string;
  canReview: boolean;
}) {
  const reasons = topReasons(row.score_breakdown);
  const flags = [
    row.client_link_status === "unknown" && FLAG_LABELS.client_unknown,
    flag(row.flags, "previously_spam") && FLAG_LABELS.previous_spam,
    flag(row.flags, "previously_off_topic") && FLAG_LABELS.previous_off_topic,
    flag(row.flags, "already_links_to_client") && FLAG_LABELS.already_links,
    row.check_reason === "domain_cap" && FLAG_LABELS.domain_cap,
  ].filter(Boolean) as string[];
  return (
    <TableRow className="align-top">
      {canReview ? (
        <TableCell>
          {row.review_status === "in_review" &&
          row.score !== null &&
          row.score_breakdown !== null ? (
            <input
              type="checkbox"
              name="row"
              value={`${row.id}:${row.row_version}`}
              aria-label={`Select ${row.normalized_url}`}
              className="accent-primary size-4"
            />
          ) : null}
        </TableCell>
      ) : null}
      <TableCell className="max-w-72 whitespace-normal">
        <Link
          href={detailHref}
          className="text-primary break-all underline-offset-4 hover:underline"
        >
          {row.normalized_url}
        </Link>
      </TableCell>
      <TableCell>{row.domain}</TableCell>
      <TableCell>
        {scoreLabel(row.score)}
        <span className="text-muted-foreground block text-xs">
          {tierLabel(row.tier)}
        </span>
      </TableCell>
      <TableCell className="max-w-64 whitespace-normal">
        {reasons.length ? reasons.join(" · ") : "—"}
      </TableCell>
      <TableCell className="whitespace-normal">
        {(row.source_types.length ? row.source_types : [row.first_source_type])
          .map((s) => SOURCE_LABELS[s as keyof typeof SOURCE_LABELS] ?? s)
          .join(", ")}
      </TableCell>
      <TableCell>{row.overlap_count}</TableCell>
      <TableCell>{activityName ?? "—"}</TableCell>
      <TableCell>
        <Badge variant="outline">{STATUS_LABELS[row.review_status]}</Badge>
        {row.review_status === "in_review" && row.reviewer_name ? (
          <span className="text-muted-foreground block text-xs">
            {row.reviewer_name}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="max-w-52 whitespace-normal">
        {flags.length ? flags.join(" · ") : "—"}
      </TableCell>
    </TableRow>
  );
}
