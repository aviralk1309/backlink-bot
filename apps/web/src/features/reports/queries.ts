import "server-only";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import type { ReportFilters } from "./filters";

export type MetricRow =
  Database["public"]["Functions"]["report_metrics"]["Returns"][number];
export type ReasonRow =
  Database["public"]["Functions"]["report_reject_reasons"]["Returns"][number];
export type ThroughputRow =
  Database["public"]["Functions"]["report_review_throughput"]["Returns"][number];
export type DeliveryRow =
  Database["public"]["Functions"]["report_link_delivery"]["Returns"][number];

export async function loadReport(filters: ReportFilters) {
  const supabase = await createClient();
  const args = {
    p_job_id: filters.job ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_activity: filters.activity ?? undefined,
  };
  const [metrics, reasons, throughput, delivery] = await Promise.all([
    supabase.rpc("report_metrics", args),
    supabase.rpc("report_reject_reasons", args),
    supabase.rpc("report_review_throughput", args),
    supabase.rpc("report_link_delivery", {
      p_job_id: filters.job ?? undefined,
      p_activity: filters.activity ?? undefined,
    }),
  ]);
  if (metrics.error || reasons.error || throughput.error || delivery.error)
    throw new Error(
      `loadReport failed: ${metrics.error?.message ?? reasons.error?.message ?? throughput.error?.message ?? delivery.error?.message}`,
    );
  return {
    metrics: (metrics.data ?? []) as MetricRow[],
    reasons: (reasons.data ?? []) as ReasonRow[],
    throughput: (throughput.data ?? []) as ThroughputRow[],
    delivery: (delivery.data ?? []) as DeliveryRow[],
  };
}

export async function listReportJobs() {
  const supabase = await createClient();
  // shortcut: the selector shows 500 jobs; add search when teams exceed that size.
  const { data, error } = await supabase
    .from("jobs")
    .select("id,name")
    .order("name")
    .limit(500);
  if (error) throw new Error(`listReportJobs failed: ${error.message}`);
  return data ?? [];
}
