import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { WorkerBeat } from "./workers";

/**
 * Runs as the signed-in user. RLS only shows these rows to system.view_health,
 * so the caller must check that permission first: without it the answer is an
 * empty list, which looks the same as "no workers".
 */
export async function listWorkerBeats(): Promise<WorkerBeat[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("worker_heartbeats")
    .select("worker_id, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`listWorkerBeats failed: ${error.message}`);
  return (data ?? []) as unknown as WorkerBeat[];
}
