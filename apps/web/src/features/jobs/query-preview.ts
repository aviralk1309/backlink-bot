import type { JobFormValues } from "./form-values";
import type { ActivityPlanProfile } from "./types";

const MAX_QUERIES = 10_000; // Keep in sync with the worker's MAX_QUERIES.
const TOKEN = /\{([^{}]*)\}/g;
const PLACEHOLDERS = new Set(["keyword", "niche", "brand", "country", "city"]);

export type PreviewRow = {
  activity: string;
  keyword: string | null;
  location: string | null;
  query: string;
};

export type SearchPreview = {
  rows: PreviewRow[];
  keywords: string[];
  activities: string[];
  locations: string[];
  omittedKeywords: string[];
  omittedActivities: string[];
  omittedLocations: string[];
  budget: number;
  maxPage: number;
};

function unique(raw: string[]): string[] {
  const seen = new Set<string>();
  return raw
    .map((value) => value.trim().replace(/\s+/g, " "))
    .filter((value) => {
      if (!value || seen.has(value.toLowerCase())) return false;
      seen.add(value.toLowerCase());
      return true;
    });
}

function* variants(
  template: string,
  names: string[],
  values: Record<string, string[]>,
  regions: string[],
): Generator<{ query: string; location: string | null }> {
  const selected: Record<string, string> = {};
  function* fill(
    index: number,
  ): Generator<{ query: string; location: string | null }> {
    if (index < names.length) {
      for (const value of values[names[index]!] ?? []) {
        selected[names[index]!] = value;
        yield* fill(index + 1);
      }
      return;
    }
    const locations = names.includes("city")
      ? [selected.city!]
      : regions.length
        ? regions
        : [null];
    for (const location of locations) {
      const query = template
        .replace(TOKEN, (_, name: string) => selected[name] ?? "")
        .trim()
        .replace(/\s+/g, " ");
      if (query) yield { query, location };
    }
  }
  yield* fill(0);
}

/** Mirrors the worker's first-page allocation; depth is scheduled after yield. */
export function previewQueries(
  job: JobFormValues,
  profiles: ActivityPlanProfile[],
): SearchPreview | null {
  const budget = Number(job.budgetCredits);
  const maxPage = Number(job.pagesPerQuery);
  if (
    !Number.isInteger(budget) ||
    budget < 0 ||
    !Number.isInteger(maxPage) ||
    maxPage < 1 ||
    maxPage > 10 ||
    !/^[A-Z]{2}$/.test(job.country) ||
    !/^[a-z]{2}$/.test(job.language)
  )
    return null;
  const keywords = unique(job.seedKeywords);
  const regions = unique(job.regions);
  const values = {
    keyword: keywords,
    niche: unique([job.subNiche, job.businessType]),
    brand: unique([job.client, ...job.brandVariants]),
    country: job.country ? [job.country] : [],
    city: regions,
  };
  const byKey = new Map(profiles.map((profile) => [profile.key, profile]));
  const activities = job.activityKeys.filter((key) => byKey.has(key));
  type Stream = {
    priority: number;
    keywordIndex: number;
    activityIndex: number;
    activity: string;
    keyword: string | null;
    variants: Generator<{ query: string; location: string | null }>;
  };
  const streams: Stream[] = [];
  for (const [activityIndex, key] of activities.entries()) {
    for (const [templateIndex, template] of byKey
      .get(key)!
      .footprint_templates.entries()) {
      if (!template.enabled || !["*", job.language].includes(template.language))
        continue;
      const names = [
        ...new Set(
          [...template.template.matchAll(TOKEN)].map((match) => match[1]!),
        ),
      ];
      if (!names.length || names.some((name) => !PLACEHOLDERS.has(name)))
        continue;
      if (names.some((name) => !values[name as keyof typeof values]?.length))
        continue;
      const selectedKeywords = names.includes("keyword") ? keywords : [null];
      for (const [keywordIndex, keyword] of selectedKeywords.entries()) {
        const offset = regions.length
          ? (keywordIndex + activityIndex + templateIndex) % regions.length
          : 0;
        const orderedRegions = [
          ...regions.slice(offset),
          ...regions.slice(0, offset),
        ];
        const variantValues =
          keyword === null ? values : { ...values, keyword: [keyword] };
        streams.push({
          priority: template.priority,
          keywordIndex,
          activityIndex,
          activity: key,
          keyword,
          variants: variants(
            template.template,
            names,
            names.includes("city")
              ? { ...variantValues, city: orderedRegions }
              : variantValues,
            orderedRegions,
          ),
        });
      }
    }
  }
  streams.sort(
    (a, b) =>
      a.priority - b.priority ||
      a.keywordIndex - b.keywordIndex ||
      a.activityIndex - b.activityIndex,
  );
  const rows: PreviewRow[] = [];
  const seen = new Set<string>();
  for (
    let index = 0;
    index < streams.length && rows.length < Math.min(budget, MAX_QUERIES);
    index++
  ) {
    const stream = streams[index]!;
    const next = stream.variants.next();
    if (next.done) continue;
    streams.push(stream);
    const { query, location } = next.value;
    const identity = `${query.toLowerCase()}\0${location?.toLowerCase() ?? ""}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    rows.push({
      activity: stream.activity,
      keyword: stream.keyword,
      location,
      query,
    });
  }
  const used = <K extends keyof PreviewRow>(field: K) =>
    new Set(rows.map((row) => row[field]));
  const usedKeywords = used("keyword");
  const usedActivities = used("activity");
  const usedLocations = used("location");
  return {
    rows,
    keywords,
    activities,
    locations: regions,
    omittedKeywords: keywords.filter((keyword) => !usedKeywords.has(keyword)),
    omittedActivities: activities.filter(
      (activity) => !usedActivities.has(activity),
    ),
    omittedLocations: regions.filter((region) => !usedLocations.has(region)),
    budget,
    maxPage,
  };
}
