import { csvCell } from "../results/export";
import type {
  DeliveryRow,
  MetricRow,
  ReasonRow,
  ThroughputRow,
} from "./queries";

export function reportCsv(report: {
  metrics: MetricRow[];
  reasons: ReasonRow[];
  throughput: ThroughputRow[];
  delivery: DeliveryRow[];
}) {
  const rows: unknown[][] = [
    [
      "table",
      "label",
      "approved",
      "used",
      "rejected",
      "undecided",
      "decided",
      "approval_rate",
      "low_sample",
      "submitted_links",
      "verified_links",
      "missing_links",
      "unknown_links",
      "credits_used",
      "credits_per_verified",
    ],
    ...report.metrics.map((row) => [
      row.dimension,
      row.dimension_key ?? "",
      row.approved_count,
      row.used_count,
      row.rejected_count,
      row.undecided_count,
      row.decided_count,
      row.approval_rate,
      row.low_sample,
    ]),
    ...report.reasons.map((row) => [
      "reject_reason",
      row.reject_reason,
      "",
      "",
      row.rejected_count,
      "",
      "",
      "",
      "",
    ]),
    ...report.throughput.map((row) => [
      "throughput_utc_day",
      row.day,
      row.approved_count,
      "",
      row.rejected_count,
      "",
      row.decided_count,
      "",
      "",
    ]),
    ...report.delivery.map((row) => [
      `delivery_${row.dimension}`,
      row.dimension_key ?? "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      row.submitted_count,
      row.verified_count,
      row.unverified_count,
      row.unknown_count,
      row.credits_used,
      row.credits_per_verified ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
