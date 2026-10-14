import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { PAGE_SIZE, sanitizeSearch, type JobListParams } from "./rules";
import {
  EMPTY_JOB_STATS,
  type ActivityOption,
  type JobEvent,
  type JobListItem,
  type JobLive,
  type JobRow,
  type JobStats,
  type JobStatus,
} from "./types";

// Like the roles queries, results are described by hand and cast, so a
// regenerated database.types.ts never breaks these files.

const LIST_COLUMNS =
  "id, name, client, client_domain, status, status_reason, config_version, activity_keys, created_at, updated_at, started_at, finished_at";

/** One page of jobs. Runs as the signed-in user, so RLS decides what shows. */
export async function listJobs(
  params: JobListParams,
): Promise<{ rows: JobListItem[]; total: number }> {
  const supabase = await createClient();
  let query = supabase.from("jobs").select(LIST_COLUMNS, { count: "exact" });

  if (params.status) query = query.eq("status", params.status);

  const q = sanitizeSearch(params.q);
  if (q) {
    // Quoted, and the characters that could break out were removed above.
    const pattern = `"*${q}*"`;
    query = query.or(
      `name.ilike.${pattern},client.ilike.${pattern},client_domain.ilike.${pattern}`,
    );
  }

  const from = (params.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  // Asking for a page past the end is not an error for the user.
  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) throw new Error(`listJobs failed: ${error.message}`);

  return {
    rows: (data ?? []) as unknown as JobListItem[],
    total: count ?? 0,
  };
}

/** How many jobs sit in each status, for the filter tabs. */
export async function getJobStatusCounts(): Promise<
  Record<JobStatus | "all", number>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("status")
    .limit(10_000);
  if (error) throw new Error(`getJobStatusCounts failed: ${error.message}`);

  const counts = { all: 0 } as Record<JobStatus | "all", number>;
  for (const row of (data ?? []) as { status: JobStatus }[]) {
    counts.all += 1;
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

/** One job with every setting, or null when it does not exist or is hidden. */
export const getJob = cache(async (id: string): Promise<JobRow | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getJob failed: ${error.message}`);
  return (data ?? null) as unknown as JobRow | null;
});

type EventQueryRow = {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
  actor: string | null;
  config_version: number | null;
  created_at: string;
  actor_profile:
    | { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[]
    | null;
};

/**
 * Newest first. The actor's name comes from profiles, which RLS only shows
 * to users with users.manage (and to the person themselves). For everyone
 * else actor_name is null and the UI shows a neutral label.
 */
export async function getJobEvents(
  jobId: string,
  limit = 100,
): Promise<JobEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_events")
    .select(
      "id, type, payload, actor, config_version, created_at, actor_profile:profiles(full_name, email)",
    )
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getJobEvents failed: ${error.message}`);

  return ((data ?? []) as unknown as EventQueryRow[]).map((e) => {
    const p = Array.isArray(e.actor_profile)
      ? e.actor_profile[0]
      : e.actor_profile;
    return {
      id: e.id,
      type: e.type,
      payload: e.payload ?? {},
      actor_id: e.actor,
      actor_name: p ? p.full_name || p.email || null : null,
      config_version: e.config_version,
      created_at: e.created_at,
    };
  });
}

/** Problem codes that block Start. An empty list means the job is ready. */
export async function getJobStartProblems(jobId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_start_problems", {
    p_job_id: jobId,
  });
  if (error) throw new Error(`job_start_problems failed: ${error.message}`);
  return (data ?? []) as string[];
}

/** Every activity profile, for the job form's checkboxes. */
export const listActivityOptions = cache(
  async (): Promise<ActivityOption[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("activity_profiles")
      .select("key, name, enabled")
      .order("name");
    if (error) throw new Error(`listActivityOptions failed: ${error.message}`);
    return (data ?? []) as ActivityOption[];
  },
);
const STATS_COLUMNS =
  "credits_used, queries_total, queries_done, unique_opportunities, duplicates_skipped, unchecked_count";

/**
 * Status and live counters for the Overview tab. Runs as the signed-in user,
 * so RLS decides: null when the job does not exist or the user may not see it.
 */
export async function getJobLive(jobId: string): Promise<JobLive | null> {
  const supabase = await createClient();
  const [jobRes, statsRes] = await Promise.all([
    supabase.from("jobs").select("status").eq("id", jobId).maybeSingle(),
    supabase
      .from("job_stats")
      .select(STATS_COLUMNS)
      .eq("job_id", jobId)
      .maybeSingle(),
  ]);
  if (jobRes.error)
    throw new Error(`getJobLive failed: ${jobRes.error.message}`);
  if (statsRes.error) {
    throw new Error(`getJobLive failed: ${statsRes.error.message}`);
  }
  if (!jobRes.data) return null;

  const stats = (statsRes.data ?? null) as unknown as JobStats | null;
  return {
    status: (jobRes.data as unknown as { status: JobStatus }).status,
    stats: stats ?? EMPTY_JOB_STATS,
  };
}
