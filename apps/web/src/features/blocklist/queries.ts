import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeSearch } from "../jobs/rules";
import { BLOCKLIST_PAGE_SIZE, type BlocklistParams } from "./rules";
import type { BlocklistEntry } from "./types";

type Joined<T> = T | T[] | null;
type Row = {
  id: string;
  domain: string;
  reason: string | null;
  source_job_id: string | null;
  created_at: string;
  adder: Joined<{ full_name: string | null; email: string | null }>;
  source_job: Joined<{ name: string | null }>;
};

const one = <T>(v: Joined<T>): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v;

/**
 * One page, newest first. Names of who added a domain (profiles) and the
 * source job come through RLS: people without users.manage / jobs.view get
 * null there and the page shows a neutral label.
 */
export async function listBlocklist(
  params: BlocklistParams,
): Promise<{ rows: BlocklistEntry[]; total: number }> {
  const supabase = await createClient();
  let query = supabase
    .from("blocklist")
    .select(
      "id, domain, reason, source_job_id, created_at, adder:profiles(full_name, email), source_job:jobs(name)",
      { count: "exact" },
    );

  const q = sanitizeSearch(params.q);
  if (q) {
    const pattern = `"*${q}*"`;
    query = query.or(`domain.ilike.${pattern},reason.ilike.${pattern}`);
  }

  const from = (params.page - 1) * BLOCKLIST_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + BLOCKLIST_PAGE_SIZE - 1);

  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) throw new Error(`listBlocklist failed: ${error.message}`);

  const rows = ((data ?? []) as unknown as Row[]).map((r) => {
    const adder = one(r.adder);
    return {
      id: r.id,
      domain: r.domain,
      reason: r.reason,
      added_by_name: adder ? adder.full_name || adder.email || null : null,
      source_job_id: r.source_job_id,
      source_job_name: one(r.source_job)?.name ?? null,
      created_at: r.created_at,
    };
  });
  return { rows, total: count ?? 0 };
}
