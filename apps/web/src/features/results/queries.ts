import "server-only";
import type { Json, Tables } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { RESULTS_PAGE_SIZE, searchPattern, type ResultsParams } from "./view";

export type ResultRow = {
  id: string;
  normalized_url: string;
  domain: string;
  score: number | null;
  tier: "high" | "medium" | "low" | "unchecked" | null;
  score_breakdown: Json | null;
  first_source_type: string;
  source_types: string[];
  overlap_count: number;
  activity_key: string | null;
  review_status: "new" | "in_review" | "approved" | "rejected" | "used";
  row_version: number;
  reviewer_name: string | null;
  flags: Json;
  client_link_status: string;
  check_reason: string | null;
  created_at: string;
};

export type DomainGroup = {
  domain: string;
  result_count: number;
  best_score: number | null;
  preview_urls: string[];
};

export type ResultDetail = Pick<
  Tables<"opportunities">,
  | "id"
  | "normalized_url"
  | "original_url"
  | "domain"
  | "score"
  | "tier"
  | "score_breakdown"
  | "check_status"
  | "check_reason"
  | "fetch_summary"
  | "activity_key"
  | "notes"
  | "external_metrics"
  | "row_version"
  | "review_status"
  | "reject_reason"
  | "reject_scope"
  | "reviewed_at"
> & {
  reviewer_name: string | null;
  domain_spam: boolean;
  checks: Pick<
    Tables<"opportunity_checks">,
    | "check_key"
    | "status"
    | "reason_code"
    | "detail"
    | "evidence"
    | "checked_at"
  >[];
  sources: Pick<
    Tables<"opportunity_sources">,
    "source_type" | "source_ref" | "found_at"
  >[];
  reviewerFields: {
    key: string;
    label: string;
    type: "text" | "number" | "url";
  }[];
  placement: {
    outreach_status: string;
    target_url: string | null;
    source_url: string | null;
    placed_at: string | null;
    verification_status: string;
    link_rel: string[];
    final_url: string | null;
    first_seen_at: string | null;
    last_checked_at: string | null;
    failure_reason: string | null;
    row_version: number;
  } | null;
};

export async function getPendingReviewCount(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("queue_group", "ready")
    .in("review_status", ["new", "in_review"]);
  if (error) throw new Error(`getPendingReviewCount failed: ${error.message}`);
  return count ?? 0;
}

export async function isDomainSpam(domain: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("domains")
    .select("global_spam")
    .eq("registered_domain", domain)
    .maybeSingle();
  if (error) throw new Error(`isDomainSpam failed: ${error.message}`);
  return data?.global_spam ?? false;
}

export async function getResultDetail(
  jobId: string,
  id: string,
): Promise<ResultDetail | null> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("opportunities")
    .select(
      "id, normalized_url, original_url, domain, score, tier, score_breakdown, check_status, check_reason, fetch_summary, activity_key, notes, external_metrics, row_version, review_status, reject_reason, reject_scope, reviewed_at",
    )
    .eq("job_id", jobId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getResultDetail failed: ${error.message}`);
  if (!row) return null;

  const [checks, sources, activity, review, domainFlag, placement] =
    await Promise.all([
      supabase
        .from("opportunity_checks")
        .select("check_key, status, reason_code, detail, evidence, checked_at")
        .eq("opportunity_id", id)
        .order("check_key"),
      supabase
        .from("opportunity_sources")
        .select("source_type, source_ref, found_at")
        .eq("opportunity_id", id)
        .order("found_at")
        .order("source_type")
        .order("source_ref")
        .range(0, 999),
      row.activity_key
        ? supabase
            .from("activity_profiles")
            .select("reviewer_fields")
            .eq("key", row.activity_key)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.rpc("result_review_state", { p_ids: [id] }),
      supabase
        .from("domains")
        .select("global_spam")
        .eq("registered_domain", row.domain)
        .maybeSingle(),
      supabase
        .from("link_placements")
        .select(
          "outreach_status,target_url,source_url,placed_at,verification_status,link_rel,final_url,first_seen_at,last_checked_at,failure_reason,row_version",
        )
        .eq("opportunity_id", id)
        .maybeSingle(),
    ]);
  if (
    checks.error ||
    sources.error ||
    activity.error ||
    review.error ||
    domainFlag.error ||
    placement.error
  )
    throw new Error("getResultDetail: related data failed");
  if (!review.data?.length) return null;

  const allSources = [...(sources.data ?? [])];
  while (allSources.length > 0 && allSources.length % 1000 === 0) {
    const next = await supabase
      .from("opportunity_sources")
      .select("source_type, source_ref, found_at")
      .eq("opportunity_id", id)
      .order("found_at")
      .order("source_type")
      .order("source_ref")
      .range(allSources.length, allSources.length + 999);
    if (next.error) throw new Error("getResultDetail: sources failed");
    allSources.push(...(next.data ?? []));
    if ((next.data ?? []).length < 1000) break;
  }

  const configured = activity.data?.reviewer_fields;
  const reviewerFields = Array.isArray(configured)
    ? configured.filter(
        (field): field is ResultDetail["reviewerFields"][number] =>
          Boolean(
            field &&
            typeof field === "object" &&
            !Array.isArray(field) &&
            typeof field.key === "string" &&
            typeof field.label === "string" &&
            ["text", "number", "url"].includes(String(field.type)),
          ),
      )
    : [];
  return {
    ...row,
    reviewer_name: review.data[0].reviewer_name,
    domain_spam: domainFlag.data?.global_spam ?? false,
    checks: checks.data ?? [],
    sources: allSources,
    placement: placement.data,
    reviewerFields: [
      { key: "dr", label: "Domain rating", type: "number" },
      { key: "traffic", label: "Monthly traffic", type: "number" },
      ...reviewerFields.filter(
        (field) => field.key !== "dr" && field.key !== "traffic",
      ),
    ],
  } as ResultDetail;
}

function args(jobId: string, p: ResultsParams, limit = RESULTS_PAGE_SIZE) {
  return {
    p_job_id: jobId,
    p_queue: p.queue === "all" ? null : p.queue,
    p_tier: p.tier,
    p_activity: p.activity,
    p_source: p.source,
    p_status: p.status,
    p_domain: p.domain,
    p_query: searchPattern(p.q),
    p_flag: p.flag,
    p_limit: limit,
  };
}

export async function listResultRows(
  jobId: string,
  p: ResultsParams,
  limit = RESULTS_PAGE_SIZE,
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_job_results", {
    ...args(jobId, p, limit),
    p_sort: p.sort,
    p_after: p.cursor,
  });
  if (error) throw new Error(`listResultRows failed: ${error.message}`);
  const rows = (data ?? []) as ResultRow[];
  const page = rows.slice(0, limit);
  if (!page.length) return { rows: [], hasMore: false };
  const { data: review, error: reviewError } = await supabase.rpc(
    "result_review_state",
    {
      p_ids: page.map((row) => row.id),
    },
  );
  if (reviewError)
    throw new Error(
      `listResultRows review state failed: ${reviewError.message}`,
    );
  const state = new Map<
    string,
    { row_version: number; reviewer_name: string | null }
  >(
    (review ?? []).map(
      (entry: {
        id: string;
        row_version: number;
        reviewer_name: string | null;
      }) => [entry.id, entry],
    ),
  );
  return {
    rows: page
      .filter((row) => state.has(row.id))
      .map((row) => ({ ...row, ...state.get(row.id)! })),
    hasMore: rows.length > limit,
  };
}

export async function listResultDomains(jobId: string, p: ResultsParams) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_job_result_domains", {
    ...args(jobId, p),
    p_after: p.cursor,
  });
  if (error) throw new Error(`listResultDomains failed: ${error.message}`);
  const rows = (data ?? []) as DomainGroup[];
  return {
    rows: rows.slice(0, RESULTS_PAGE_SIZE),
    hasMore: rows.length > RESULTS_PAGE_SIZE,
  };
}
