import { jobIdSchema } from "../jobs/schemas";

export type ReportFilters = {
  job: string | null;
  from: string | null;
  to: string | null;
  activity: string | null;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

export function parseReportFilters(
  raw: Record<string, string | string[] | undefined>,
  fixedJob?: string,
): ReportFilters | null {
  const values = [raw.job, raw.from, raw.to, raw.activity];
  if (values.some((value) => Array.isArray(value))) return null;
  const [job, from, to, activity] = values as (string | undefined)[];
  if (
    (job && !jobIdSchema.safeParse(job).success) ||
    (from && !validDate(from)) ||
    (to && !validDate(to)) ||
    (from && to && from > to) ||
    (activity && !/^[a-z][a-z0-9_]{1,49}$/.test(activity))
  )
    return null;
  return {
    job: fixedJob ?? job ?? null,
    from: from || null,
    to: to || null,
    activity: activity || null,
  };
}

export function reportExportHref(filters: ReportFilters) {
  const params = new URLSearchParams();
  if (filters.job) params.set("job", filters.job);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.activity) params.set("activity", filters.activity);
  const query = params.toString();
  return `/api/reports/export${query ? `?${query}` : ""}`;
}
