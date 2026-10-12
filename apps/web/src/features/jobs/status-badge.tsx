import { StatusBadge as Badge } from "@/components/ui/status-badge";
import { JOB_STATUS_LABELS } from "./rules";
import type { JobStatus } from "./types";

type Tone = "neutral" | "info" | "brand" | "success" | "warning" | "danger";

const TONE: Record<JobStatus, Tone> = {
  draft: "neutral",
  queued: "info",
  running: "brand",
  paused: "warning",
  saturated: "warning",
  completed: "success",
  failed: "danger",
  stopped: "neutral",
};

/** The status label in its colour. The text always says the status. */
export function StatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={TONE[status]}>{JOB_STATUS_LABELS[status]}</Badge>;
}
