import { AuthError, requirePermission } from "@/lib/auth/session";
import { reportCsv } from "@/features/reports/export";
import { parseReportFilters } from "@/features/reports/filters";
import { loadReport } from "@/features/reports/queries";

export async function GET(request: Request) {
  try {
    await requirePermission("reports.view");
  } catch (error) {
    if (error instanceof AuthError)
      return new Response("Forbidden", {
        status: error.code === "unauthenticated" ? 401 : 403,
      });
    throw error;
  }

  const params = new URL(request.url).searchParams;
  const raw: Record<string, string | string[] | undefined> = {};
  for (const key of ["job", "from", "to", "activity"]) {
    const values = params.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  const filters = parseReportFilters(raw);
  if (!filters) return new Response("Invalid report filters", { status: 400 });

  try {
    const report = await loadReport(filters);
    return new Response(reportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${filters.job ?? "all"}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("report export failed", error);
    return new Response("Could not export report", { status: 500 });
  }
}
