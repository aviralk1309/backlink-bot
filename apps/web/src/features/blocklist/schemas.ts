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
