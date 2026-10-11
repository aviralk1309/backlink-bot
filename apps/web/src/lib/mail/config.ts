import "server-only";
import { z } from "zod";

const base = z.object({
  APP_URL: z.url(),
  MAIL_FROM: z.string().min(3),
  MAIL_MODE: z.enum(["smtp", "console"]).default("smtp"),
});

const smtp = z.object({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
});

export type MailConfig =
  | { mode: "console"; from: string; appUrl: string }
  | {
      mode: "smtp";
      from: string;
      appUrl: string;
      host: string;
      port: number;
      user: string;
      pass: string;
    };

let cached: MailConfig | undefined;

/** Parsed lazily so builds and tests that never send mail need no SMTP env. */
export function getMailConfig(): MailConfig {
  if (cached) return cached;
  const b = base.parse(process.env);
  const appUrl = b.APP_URL.replace(/\/+$/, "");

  if (b.MAIL_MODE === "console") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MAIL_MODE=console is not allowed in production");
    }
    cached = { mode: "console", from: b.MAIL_FROM, appUrl };
    return cached;
  }

  const s = smtp.parse(process.env);
  cached = {
    mode: "smtp",
    from: b.MAIL_FROM,
    appUrl,
    host: s.SMTP_HOST,
    port: s.SMTP_PORT,
    user: s.SMTP_USER,
    pass: s.SMTP_PASS,
  };
  return cached;
}
