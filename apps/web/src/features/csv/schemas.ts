import { z } from "zod";

/** Sent by the upload form once the file is in Storage. */
export const registerUploadSchema = z.object({
  job_id: z.string().uuid("Reload the page and try again."),
  upload_id: z
    .string()
    .uuid("Reload the page and try again.")
    .transform((v) => v.toLowerCase()),
  kind: z.enum(["competitor", "client"], {
    message: "Choose competitor or client.",
  }),
  competitor: z.string().trim().max(2048).default(""),
  filename: z
    .string()
    .trim()
    .min(1, "The file has no name.")
    .max(255, "The file name is too long."),
});

export const discardUploadSchema = z.object({
  job_id: z.string().uuid("Reload the page and try again."),
  upload_id: z.string().uuid("Reload the page and try again."),
});

export const deleteUploadSchema = z.object({
  job_id: z.string().uuid("Reload the page and try again."),
  upload_id: z.string().uuid("Reload the page and try again."),
});

export const confirmUploadSchema = z.object({
  job_id: z.string().uuid("Reload the page and try again."),
  upload_id: z.string().uuid("Reload the page and try again."),
});

// ---------------------------------------------------------------------------
// Save mapping (M4-S4)
// ---------------------------------------------------------------------------

const COLUMN_TYPE_VALUES = ["text", "number", "date", "ignore"] as const;

export const columnMappingSchema = z.object({
  index: z.number().int().min(0, "Column index must be 0 or greater."),
  source: z.string(),
  label: z
    .string()
    .trim()
    .min(1, "Every mapped column needs a label.")
    .max(200),
  type: z.enum(COLUMN_TYPE_VALUES, {
    message: "Choose text, number, date or ignore.",
  }),
});

export const csvMappingSchema = z.object({
  url_index: z.number().int().min(0),
  url_column: z.string().trim().min(1).max(200),
  columns: z.array(columnMappingSchema),
});

/**
 * Validates the payload sent by the mapping screen to saveCsvMappingAction.
 * url_index + url_column are required; columns defaults to [].
 * template_id and template_name are optional (save-as-template flow).
 */
export const saveMappingSchema = z
  .object({
    job_id: z.string().uuid("Reload the page and try again."),
    upload_id: z.string().uuid("Reload the page and try again."),
    url_index: z.number().int().min(0, "Choose the URL column."),
    url_column: z
      .string()
      .trim()
      .min(1, "The URL column needs a label.")
      .max(200),
    columns: z.array(columnMappingSchema).default([]),
    template_id: z.string().uuid().nullish(),
    save_as_template: z.boolean().default(false),
    template_name: z.string().trim().max(100).default(""),
  })
  .refine((d) => !d.save_as_template || d.template_name.length > 0, {
    message: "Name the template.",
    path: ["template_name"],
  });
