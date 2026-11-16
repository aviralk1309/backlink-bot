import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/ui/notice";
import { LocalTime } from "./local-time";
import { RescoreButton } from "./rescore-button";

export async function RescorePanel({ jobId }: { jobId: string }) {
  const supabase = await createClient();
  const { data: latest, error } = await supabase
    .from("job_rescore_requests")
    .select("status, scored_count, requested_at")
    .eq("job_id", jobId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    return (
      <Notice tone="error">
        Could not load rescore status. Reload to try again.
      </Notice>
    );
  return (
    <section
      aria-label="Rescore results"
      className="bg-card space-y-3 rounded-xl border p-5"
    >
      <h2 className="text-base font-semibold">Rescore results</h2>
      {latest ? (
        <p className="text-muted-foreground text-sm">
          Requested <LocalTime iso={latest.requested_at} /> ·{" "}
          {latest.status === "pending"
            ? "Queued for a worker. Refresh this page or check Activity for completion."
            : latest.status === "done"
              ? `Updated ${latest.scored_count} results.`
              : "Rescore failed; no scores changed. Check scoring settings before retrying."}
        </p>
      ) : null}
      {latest?.status !== "pending" ? <RescoreButton jobId={jobId} /> : null}
    </section>
  );
}
