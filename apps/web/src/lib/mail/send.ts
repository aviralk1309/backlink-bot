import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getMailConfig } from "./config";
import type { RenderedEmail } from "./templates";

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const cfg = getMailConfig();
  if (cfg.mode !== "smtp") throw new Error("SMTP is not configured");
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/**
 * Sends one email. In console mode (local dev only) the message is printed
 * to the server log instead, so invite and reset links can be clicked
 * without any mail account.
 */
export async function sendMail(to: string, email: RenderedEmail) {
  const cfg = getMailConfig();
  if (cfg.mode === "console") {
    console.info(`[mail:console] to=${to} subject="${email.subject}"`);
    console.info(email.text);
    return;
  }
  await getTransporter().sendMail({
    from: cfg.from,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

export function appUrl(path: string): string {
  return `${getMailConfig().appUrl}${path}`;
}
