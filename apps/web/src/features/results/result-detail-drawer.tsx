"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { BlockFromReview } from "@/features/blocklist/review-block";
import type { FormState } from "@/lib/auth/schemas";
import type { Json } from "@/lib/database.types";
import { saveLinkPlacementAction, saveResultMetadataAction } from "./actions";
import type { ResultDetail } from "./queries";
import { ReviewActions } from "./review-actions";
import { REJECT_REASONS } from "./review-input";

function object(value: Json | null): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {};
}

function shown(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function json(value: Json | null): string {
  return value === null ? "Not available" : JSON.stringify(value, null, 2);
}

function Evidence({ value }: { value: Json | null }) {
  return (
    <pre className="bg-muted/50 max-h-72 overflow-auto rounded-lg border p-3 text-xs break-all whitespace-pre-wrap">
      {json(value)}
    </pre>
  );
}

function MetadataForm({
  detail,
  jobId,
}: {
  detail: ResultDetail;
  jobId: string;
}) {
  const [state, action, pending] = useActionState(
    saveResultMetadataAction,
    {} as FormState,
  );
  const metrics = object(detail.external_metrics);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="opportunity_id" value={detail.id} />
      <input type="hidden" name="row_version" value={detail.row_version} />
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.message ? <Notice tone="success">{state.message}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {detail.reviewerFields.map((field) => {
          const stored = metrics[field.key];
          return (
            <label key={field.key} className="space-y-1 text-sm">
              <span>{field.label}</span>
              <Input
                name={`metric:${field.key}`}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "url"
                      ? "url"
                      : "text"
                }
                inputMode={field.type === "number" ? "decimal" : undefined}
                min={field.type === "number" ? 0 : undefined}
                max={
                  field.type === "number"
                    ? field.key === "dr"
                      ? 100
                      : 1_000_000_000
                    : undefined
                }
                step={field.type === "number" ? "any" : undefined}
                maxLength={field.type === "url" ? 2048 : 500}
                defaultValue={
                  typeof stored === "string" || typeof stored === "number"
                    ? stored
                    : ""
                }
                disabled={pending}
              />
            </label>
          );
        })}
      </div>
      <label className="block space-y-1 text-sm">
        <span>Notes</span>
        <Textarea
          name="notes"
          defaultValue={detail.notes ?? ""}
          maxLength={4000}
          rows={5}
          disabled={pending}
        />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save notes and metrics"}
      </Button>
    </form>
  );
}

function OutreachForm({
  detail,
  jobId,
}: {
  detail: ResultDetail;
  jobId: string;
}) {
  const [state, action, pending] = useActionState(
    saveLinkPlacementAction,
    {} as FormState,
  );
  const placement = detail.placement;
  return (
    <section className="space-y-3" aria-label="Outreach and placed link">
      <h3 className="font-semibold">Outreach and placed link</h3>
      <p className="text-muted-foreground text-sm">
        Add a live source page after your link is placed. Verification runs when
        the bot contact and link checks are enabled.
      </p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="opportunity_id" value={detail.id} />
        <input
          type="hidden"
          name="placement_version"
          value={placement?.row_version ?? 0}
        />
        {state.error ? <Notice tone="error">{state.error}</Notice> : null}
        {state.message ? <Notice tone="success">{state.message}</Notice> : null}
        <label className="block space-y-1 text-sm">
          <span>Outreach status</span>
          <NativeSelect
            name="outreach_status"
            defaultValue={placement?.outreach_status ?? "not_contacted"}
            disabled={pending}
          >
            <option value="not_contacted">Not contacted</option>
            <option value="contacted">Contacted</option>
            <option value="negotiating">Negotiating</option>
            <option value="live">Link placed</option>
            <option value="closed">Closed</option>
          </NativeSelect>
        </label>
        <label className="block space-y-1 text-sm">
          <span>Target page on client website</span>
          <Input
            type="url"
            name="target_url"
            defaultValue={placement?.target_url ?? ""}
            maxLength={2048}
            disabled={pending}
            placeholder="https://client.example/page"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Page where the backlink appears</span>
          <Input
            type="url"
            name="source_url"
            defaultValue={placement?.source_url ?? ""}
            maxLength={2048}
            disabled={pending}
            placeholder="https://publisher.example/article"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Placement date</span>
          <Input
            type="date"
            name="placed_at"
            defaultValue={placement?.placed_at ?? ""}
            disabled={pending}
          />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save outreach"}
        </Button>
      </form>
      <p className="text-sm">
        Verification:{" "}
        <strong>
          {(placement?.verification_status ?? "not_submitted").replaceAll(
            "_",
            " ",
          )}
        </strong>
        {placement?.link_rel.length
          ? ` · ${placement.link_rel.join(", ")}`
          : ""}
      </p>
      {placement?.last_checked_at ? (
        <DetailLine label="Last checked" value={placement.last_checked_at} />
      ) : null}
      {placement?.first_seen_at ? (
        <DetailLine label="First seen" value={placement.first_seen_at} />
      ) : null}
      {placement?.final_url ? (
        <DetailLine label="Final source URL" value={placement.final_url} />
      ) : null}
      {placement?.failure_reason ? (
        <DetailLine label="Check result" value={placement.failure_reason} />
      ) : null}
    </section>
  );
}

export function ResultDetailDrawer({
  detail,
  jobId,
  closeHref,
  nextHref,
  domainReviewHref,
  canReview,
  canReopen,
  canManageBlocklist,
}: {
  detail: ResultDetail;
  jobId: string;
  closeHref: string;
  nextHref: string | null;
  domainReviewHref: string;
  canReview: boolean;
  canReopen: boolean;
  canManageBlocklist: boolean;
}) {
  const router = useRouter();
  const breakdown = object(detail.score_breakdown);
  const components = Array.isArray(breakdown.components)
    ? breakdown.components
    : [];
  const fetch = object(detail.fetch_summary);
  const chain = Array.isArray(fetch.redirect_chain) ? fetch.redirect_chain : [];
  const domain = encodeURIComponent(detail.domain);
  const links = [
    [
      "Ahrefs",
      `https://ahrefs.com/site-explorer/overview/v2/subdomains/live?target=${domain}`,
    ],
    ["Semrush", `https://www.semrush.com/analytics/overview/?q=${domain}`],
    [
      "Google Search Console",
      `https://search.google.com/search-console?resource_id=${encodeURIComponent(`sc-domain:${detail.domain}`)}`,
    ],
  ] as const;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.replace(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        className="w-full sm:max-w-2xl"
        aria-describedby="result-detail-description"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Result detail</SheetTitle>
          <SheetDescription
            id="result-detail-description"
            className="break-all"
          >
            {detail.normalized_url}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-4 pb-6">
          <section className="space-y-3" aria-label="Page and lookup links">
            <DetailLine label="Normalized URL" value={detail.normalized_url} />
            <DetailLine label="Original URL" value={detail.original_url} />
            <div className="flex flex-wrap gap-2">
              <ExternalLinkAnchor href={detail.normalized_url}>
                Open page
              </ExternalLinkAnchor>
              {links.map(([label, href]) => (
                <ExternalLinkAnchor key={label} href={href}>
                  {label}
                </ExternalLinkAnchor>
              ))}
            </div>
          </section>

          <ReviewActions
            key={detail.id}
            detail={detail}
            jobId={jobId}
            nextHref={nextHref}
            domainReviewHref={domainReviewHref}
            closeHref={closeHref}
            canReview={canReview}
            canReopen={canReopen}
          />
          {canReview &&
          (detail.review_status === "approved" ||
            detail.review_status === "used") ? (
            <OutreachForm key={detail.id} detail={detail} jobId={jobId} />
          ) : null}
          {canManageBlocklist && detail.review_status === "rejected" ? (
            <BlockFromReview
              key={detail.id}
              jobId={jobId}
              domain={detail.domain}
              resultId={detail.id}
              defaultReason={
                detail.reject_reason
                  ? `Rejected: ${REJECT_REASONS[detail.reject_reason]}`
                  : "Rejected result"
              }
              rejectScope={detail.reject_scope}
            />
          ) : null}

          <section className="space-y-3" aria-label="Score breakdown">
            <h3 className="font-semibold">Score breakdown</h3>
            <p className="text-sm">
              {shown(detail.score)} points · {shown(detail.tier)} tier
            </p>
            {components.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2">Component</th>
                      <th className="p-2">Raw</th>
                      <th className="p-2">Weight</th>
                      <th className="p-2">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((component, index) => {
                      const item = object(component);
                      return (
                        <tr key={index} className="border-t">
                          <td className="p-2">{shown(item.component)}</td>
                          <td className="p-2">{shown(item.raw)}</td>
                          <td className="p-2">{shown(item.weight)}</td>
                          <td className="p-2">{shown(item.points)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Full scoring data
              </summary>
              <div className="mt-2">
                <Evidence value={detail.score_breakdown} />
              </div>
            </details>
          </section>

          <section className="space-y-3" aria-label="Checks and evidence">
            <h3 className="font-semibold">
              Checks and evidence ({detail.checks.length})
            </h3>
            <p className="text-muted-foreground text-sm">
              Pipeline: {detail.check_status}
              {detail.check_reason ? ` · ${detail.check_reason}` : ""}
            </p>
            {detail.checks.length ? (
              detail.checks.map((check) => (
                <details
                  key={check.check_key}
                  className="rounded-lg border p-3"
                >
                  <summary className="cursor-pointer font-medium">
                    {check.check_key} · {check.status}
                  </summary>
                  <div className="mt-3 space-y-2 text-sm">
                    <DetailLine label="Reason" value={check.reason_code} />
                    <DetailLine label="Detail" value={check.detail} />
                    <DetailLine label="Checked at" value={check.checked_at} />
                    <p className="font-medium">Evidence</p>
                    <Evidence value={check.evidence} />
                  </div>
                </details>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">
                No checks recorded yet.
              </p>
            )}
          </section>

          <section className="space-y-3" aria-label="Found by">
            <h3 className="font-semibold">
              Found by ({detail.sources.length})
            </h3>
            {detail.sources.length ? (
              <ul className="space-y-2">
                {detail.sources.map((source) => (
                  <li
                    key={`${source.source_type}:${source.source_ref}`}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <span className="font-medium">{source.source_type}</span>
                    <span className="block break-all">{source.source_ref}</span>
                    <span className="text-muted-foreground text-xs">
                      {source.found_at}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">
                No source records available.
              </p>
            )}
          </section>

          <section className="space-y-3" aria-label="Fetch information">
            <h3 className="font-semibold">Fetch information</h3>
            <DetailLine label="Outcome" value={fetch.outcome} />
            <DetailLine label="Reason" value={fetch.reason_code} />
            <DetailLine label="HTTP status" value={fetch.status_code} />
            <DetailLine label="Final URL" value={fetch.final_url} />
            <DetailLine label="Elapsed seconds" value={fetch.elapsed_seconds} />
            <DetailLine label="Error" value={fetch.error_message} />
            <h4 className="text-sm font-medium">Redirect chain</h4>
            {chain.length ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {chain.map((step, index) => {
                  const item = object(step);
                  return (
                    <li key={index} className="break-all">
                      {shown(item.status_code)} · {shown(item.url)}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-muted-foreground text-sm">
                No redirects recorded.
              </p>
            )}
          </section>

          <section
            className="space-y-3"
            aria-label="Review notes and external metrics"
          >
            <h3 className="font-semibold">External metrics and notes</h3>
            {canReview ? (
              <MetadataForm
                key={`${detail.id}:${detail.row_version}`}
                detail={detail}
                jobId={jobId}
              />
            ) : (
              <div className="space-y-2 text-sm">
                {Object.entries(object(detail.external_metrics)).map(
                  ([key, value]) => (
                    <DetailLine key={key} label={key} value={value} />
                  ),
                )}
                <DetailLine label="Notes" value={detail.notes} />
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailLine({ label, value }: { label: string; value: unknown }) {
  return (
    <p className="text-sm break-words">
      <span className="text-muted-foreground">{label}: </span>
      {shown(value)}
    </p>
  );
}

function ExternalLinkAnchor({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="border-input hover:bg-muted inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm"
    >
      <ExternalLink aria-hidden className="size-3.5" />
      {children}
    </a>
  );
}
