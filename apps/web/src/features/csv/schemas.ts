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
