import { z } from "zod";
import { REASON_MAX, parseDomainBatch } from "./rules";

const guid = z.guid("That request was not valid.");

const reason = z
  .string()
  .trim()
  .max(REASON_MAX, `Reason is too long (${REASON_MAX} characters max).`)
  .optional()
  .transform((v) => (v ? v : null));

export const addBlocklistSchema = z.object({
  domains: z
    .string({ error: "Enter at least one domain." })
    .transform((raw, ctx) => {
      const r = parseDomainBatch(raw);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.error });
        return z.NEVER;
      }
      return r.domains;
    }),
  reason,
});

export const updateReasonSchema = z.object({ id: guid, reason });
export const removeBlocklistSchema = z.object({ id: guid });

const reviewedDomain = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,}$/);
const reviewReason = z
  .string({ error: "Enter a reason for blocking this domain." })
  .trim()
  .min(1, "Enter a reason for blocking this domain.")
  .max(REASON_MAX, `Reason is too long (${REASON_MAX} characters max).`);

export const blockFromReviewSchema = z
  .object({
    jobId: guid,
    resultId: guid.optional(),
    domain: reviewedDomain.optional(),
    reason: reviewReason,
  })
  .refine((v) => Boolean(v.resultId) !== Boolean(v.domain), {
    message: "Choose a rejected result or domain.",
  });

export const undoReviewBlockSchema = z.object({
  id: guid,
  jobId: guid,
  domain: reviewedDomain,
  reason: reviewReason,
});
