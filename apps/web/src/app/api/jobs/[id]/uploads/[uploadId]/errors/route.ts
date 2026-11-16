import { NextResponse } from "next/server";
import { AuthError, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CSV_BUCKET } from "@/features/csv/limits";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  try {
    await requirePermission("csv.upload");
  } catch (err) {
    if (err instanceof AuthError) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    throw err;
  }

  const { id: jobId, uploadId } = await params;
  const supabase = await createClient();

  const { data: upload, error: uploadErr } = await supabase
    .from("csv_uploads")
    .select("id, filename, error_report_path")
    .eq("id", uploadId)
    .eq("job_id", jobId)
    .maybeSingle();

  if (uploadErr || !upload) {
    return new NextResponse("Upload not found", { status: 404 });
  }

  const filename = `${upload.filename.replace(/\.csv$/i, "")}_errors.csv`;

  // 1. If error report path exists in storage, stream it directly
  if (upload.error_report_path) {
    const { data: fileData, error: storageErr } = await supabase.storage
      .from(CSV_BUCKET)
      .download(upload.error_report_path);

    if (!storageErr && fileData) {
      return new NextResponse(fileData, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }
  }

  // 2. Fallback: generate from csv_rows
  const { data: rows, error: rowsErr } = await supabase
    .from("csv_rows")
    .select("row_no, raw_url, error_code")
    .eq("upload_id", uploadId)
    .eq("is_valid", false)
    .order("row_no", { ascending: true });

  if (rowsErr) {
    return new NextResponse("Failed to load errors", { status: 500 });
  }

  const csvLines = ["row_no,raw_url,error_reason"];
  for (const r of rows ?? []) {
    const escapedUrl = `"${(r.raw_url ?? "").replace(/"/g, '""')}"`;
    csvLines.push(`${r.row_no},${escapedUrl},${r.error_code ?? "unknown"}`);
  }

  return new NextResponse(csvLines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
