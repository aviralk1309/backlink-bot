import type { ResultDetail } from "./queries";

export function metricPatch(
  formData: FormData,
  fields: ResultDetail["reviewerFields"],
): { values: Record<string, string | number | null> } | { error: string } {
  const values: Record<string, string | number | null> = {};
  for (const field of fields) {
    const raw = formData.get(`metric:${field.key}`);
    if (typeof raw !== "string")
      return { error: `Missing ${field.label}. Reload and try again.` };
    const value = raw.trim();
    if (!value) {
      values[field.key] = null;
    } else if (field.type === "number") {
      const maximum = field.key === "dr" ? 100 : 1_000_000_000;
      if (
        !/^\d+(?:\.\d+)?$/.test(value) ||
        !Number.isFinite(Number(value)) ||
        Number(value) > maximum
      )
        return {
          error: `${field.label} must be a number from 0 to ${maximum.toLocaleString("en-US")}.`,
        };
      values[field.key] = Number(value);
    } else if (field.type === "url") {
      try {
        if (
          value.length > 2048 ||
          !["http:", "https:"].includes(new URL(value).protocol)
        )
          return {
            error: `${field.label} must be an HTTP or HTTPS URL (2048 characters max).`,
          };
      } catch {
        return { error: `${field.label} must be an HTTP or HTTPS URL.` };
      }
      values[field.key] = value;
    } else {
      if (value.length > 500)
        return { error: `${field.label} is too long (500 characters max).` };
      values[field.key] = value;
    }
  }
  return { values };
}
