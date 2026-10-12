import { z } from "zod";
import { LANGUAGE_CODES } from "../jobs/locales";
import { cleanTextList } from "../jobs/rules";
import { sortTemplates, templateProblem, weightsTotal } from "./rules";
import { REVIEWER_FIELD_TYPES } from "./types";

const guid = z.guid("That request was not valid.");
export const activityIdSchema = guid;

const KEY = /^[a-z][a-z0-9_]{1,49}$/;
const ID = /^[a-z0-9_]{1,40}$/;

/** A whole number. Anything else (blank, text) gets a message naming the field. */
function whole(label: string, min: number, max: number) {
  return z
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`)
    .max(max, `${label} must be at most ${max}.`);
}

/** A phrase list: cleaned, lowercase, no duplicates. */
function phrases(label: string, maxItems: number, maxLen: number) {
  return z
    .array(z.string({ error: `${label} is not valid.` }))
    .transform((raw, ctx) => {
      const r = cleanTextList(raw, {
        label,
        max: maxItems,
        maxLen,
        lower: true,
      });
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error });
        return z.NEVER;
      }
      return r.values;
    });
}

const templateSchema = z
  .object({
    id: z.string().regex(ID, "A search template has an invalid id."),
    template: z.string({ error: "Enter the search text." }),
    language: z.string(),
    priority: whole("Priority", 1, 99),
    enabled: z.boolean(),
  })
  .transform((t, ctx) => {
    const problem = templateProblem(t.template);
    if (problem) {
      ctx.addIssue({
        code: "custom",
        message: `Search template “${t.template.trim().slice(0, 40)}”: ${problem}`,
      });
      return z.NEVER;
    }
    if (t.language !== "*" && !LANGUAGE_CODES.has(t.language)) {
      ctx.addIssue({
        code: "custom",
        message: "A search template has a language that is not in the list.",
      });
      return z.NEVER;
    }
    return { ...t, template: t.template.replace(/\s+/g, " ").trim() };
  });

const reviewerFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]{0,29}$/,
      "Reviewer field keys use lowercase letters, digits and underscores, and start with a letter.",
    ),
  label: z
    .string()
    .trim()
    .min(1, "Every reviewer field needs a label.")
    .max(40, "A reviewer field label is too long (40 characters max)."),
  type: z.enum(REVIEWER_FIELD_TYPES, {
    error: "A reviewer field has an invalid type.",
  }),
});

export const configSchema = z
  .object({
    per_domain_cap: whole("Per-domain cap", 1, 1000),
    footprint_templates: z
      .array(templateSchema)
      .max(50, "At most 50 search templates."),
    page_type_signals: z.object({
      url_patterns: phrases("URL patterns", 30, 100),
      title_phrases: phrases("Title phrases", 30, 100),
      heading_phrases: phrases("Heading phrases", 30, 100),
      body_phrases: phrases("Body phrases", 30, 100),
      structure: z.object({
        link_list: z.boolean(),
        min_outbound_links: whole("Minimum outbound links", 0, 1000),
      }),
    }),
    relevance_rule: z.object({
      field_weights: z.object({
        title: whole("Title weight", 0, 10),
        headings: whole("Headings weight", 0, 10),
        meta: whole("Meta description weight", 0, 10),
        body: whole("Body text weight", 0, 10),
      }),
      min_score: z
        .number({ error: "Minimum relevance must be a number." })
        .min(0, "Minimum relevance must be between 0 and 1.")
        .max(1, "Minimum relevance must be between 0 and 1."),
    }),
    scoring_weights: z.object({
      relevance: whole("Relevance weight", 0, 100),
      language_region: whole("Language and region weight", 0, 100),
      activity_fit: whole("Activity fit weight", 0, 100),
      overlap: whole("Overlap weight", 0, 100),
      multi_query: whole("Found-by-many-queries weight", 0, 100),
      spam_penalty: whole("Spam penalty", 0, 100),
    }),
    reviewer_fields: z
      .array(reviewerFieldSchema)
      .max(12, "At most 12 reviewer fields."),
  })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const t of c.footprint_templates) {
      if (ids.has(t.id)) {
        ctx.addIssue({
          code: "custom",
          message: "Search template ids repeat.",
        });
        break;
      }
      ids.add(t.id);
    }
    const keys = new Set<string>();
    for (const f of c.reviewer_fields) {
      if (keys.has(f.key)) {
        ctx.addIssue({
          code: "custom",
          message: `Reviewer field key “${f.key}” is used twice.`,
        });
        break;
      }
      keys.add(f.key);
    }
    const total = weightsTotal(c.scoring_weights);
    if (total !== 100) {
      ctx.addIssue({
        code: "custom",
        message: `The five scoring weights must add up to 100 (they add up to ${total}).`,
      });
    }
    const fw = c.relevance_rule.field_weights;
    if (fw.title + fw.headings + fw.meta + fw.body === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Give at least one relevance field a weight above 0.",
      });
    }
  })
  .transform((c) => ({
    ...c,
    // Same content always saves the same way, so a re-save is not a new version.
    footprint_templates: sortTemplates(c.footprint_templates),
  }));

export type ParsedConfig = z.output<typeof configSchema>;

const jsonConfig = z
  .string({ error: "The form could not be read. Reload the page." })
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "The form could not be read. Reload the page.",
      });
      return z.NEVER;
    }
  })
  .pipe(configSchema);

export const saveActivitySchema = z
  .object({
    activity_id: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      guid.optional(),
    ),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((v) => v ?? ""),
    name: z
      .string()
      .trim()
      .min(1, "Enter a name for the activity.")
      .max(80, "Name is too long (80 characters max)."),
    enabled: z
      .string()
      .optional()
      .transform((v) => v === "on"),
    seen_updated_at: z.string().optional(),
    config: jsonConfig,
  })
  .superRefine((d, ctx) => {
    if (d.activity_id) {
      if (!d.seen_updated_at) {
        ctx.addIssue({
          code: "custom",
          message: "That request was not valid. Reload the page.",
        });
      }
    } else if (!KEY.test(d.key)) {
      ctx.addIssue({
        code: "custom",
        path: ["key"],
        message:
          "The key must be 2 to 50 characters: lowercase letters, digits and underscores, starting with a letter.",
      });
    }
    if (d.enabled && !d.config.footprint_templates.some((t) => t.enabled)) {
      ctx.addIssue({
        code: "custom",
        message:
          "An enabled activity needs at least one enabled search template. Add one, or switch the activity off.",
      });
    }
  });

/** FormData to the plain object saveActivitySchema reads. */
export function activityFormInput(formData: FormData) {
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : undefined;
  };
  return {
    activity_id: text("activity_id"),
    key: text("key"),
    name: text("name"),
    enabled: text("enabled"),
    seen_updated_at: text("seen_updated_at"),
    config: text("config"),
  };
}
