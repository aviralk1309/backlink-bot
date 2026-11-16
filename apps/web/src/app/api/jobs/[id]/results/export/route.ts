import { AuthError, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { jobIdSchema } from "@/features/jobs/schemas";
import {
  exportChunks,
  parseExportForm,
  type ExportRow,
} from "@/features/results/export";
import { searchPattern } from "@/features/results/view";

const BATCH_SIZE = 500;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return new Response("Forbidden", { status: 403 });

  try {
    await requirePermission("jobs.view");
    await requirePermission("results.view");
    await requirePermission("results.export");
  } catch (error) {
    if (error instanceof AuthError)
      return new Response("Forbidden", {
        status: error.code === "unauthenticated" ? 401 : 403,
      });
    throw error;
  }

  const { id: jobId } = await params;
  if (!jobIdSchema.safeParse(jobId).success)
    return new Response("Invalid job", { status: 400 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("Invalid export request", { status: 400 });
  }
  const input = parseExportForm(form);
  if (!input) return new Response("Invalid export request", { status: 400 });

  const { columns, params: filters } = input;
  const supabase = await createClient();
  const batchArgs = {
    p_job_id: jobId,
    p_queue: filters.queue === "all" ? null : filters.queue,
    p_tier: filters.tier,
    p_activity: filters.activity,
    p_source: filters.source,
    p_status: filters.status,
    p_domain: filters.domain,
    p_query: searchPattern(filters.q),
    p_flag: filters.flag,
    p_limit: BATCH_SIZE,
  };
  const readBatch = async (after: string | null): Promise<ExportRow[]> => {
    const { data, error } = await supabase.rpc("export_result_batch", {
      ...batchArgs,
      p_after: after,
    });
    if (error) throw error;
    return (data ?? []) as ExportRow[];
  };

  let first: ExportRow[];
  try {
    first = await readBatch(null);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42501"
    )
      return new Response("Forbidden", { status: 403 });
    console.error("export_result_batch failed", error);
    return new Response("Could not load results", { status: 500 });
  }
  const { error: logError } = await supabase.rpc("log_result_export", {
    p_job_id: jobId,
    p_filters: {
      queue: filters.queue,
      tier: filters.tier,
      activity: filters.activity,
      source: filters.source,
      status: filters.status,
      domain: filters.domain,
      q: filters.q,
      flag: filters.flag,
    },
    p_columns: columns,
  });
  if (logError) {
    if (logError.code === "P0002")
      return new Response("Job not found", { status: 404 });
    if (logError.code === "42501")
      return new Response("Forbidden", { status: 403 });
    console.error("log_result_export failed", logError);
    return new Response("Could not start export", { status: 500 });
  }

  const encoder = new TextEncoder();
  const chunks = exportChunks(first, columns, BATCH_SIZE, readBatch);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (request.signal.aborted) {
        controller.close();
        return;
      }
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (error) {
        console.error("export_result_batch failed during stream", error);
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="job-${jobId}-results.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
