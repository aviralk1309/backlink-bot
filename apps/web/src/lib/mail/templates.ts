export const APP_NAME = "Web-crawler-bot";

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

type Layout = {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footnote?: string;
};

/** Every user-supplied value is escaped here, once, for the HTML body. */
function render(layout: Layout): RenderedEmail {
  const { subject, heading, paragraphs, cta, footnote } = layout;

  const htmlParagraphs = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#27272a">${escapeHtml(p)}</p>`,
    )
    .join("");
  const htmlCta = cta
    ? `<p style="margin:24px 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 20px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-size:15px">${escapeHtml(cta.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#52525b">Or paste this link into your browser:<br>${escapeHtml(cta.url)}</p>`
    : "";
  const htmlFoot = footnote
    ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#52525b">${escapeHtml(footnote)}</p>`
    : "";

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif">` +
    `<div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:8px">` +
    `<p style="margin:0 0 4px;font-size:13px;color:#52525b">${escapeHtml(APP_NAME)}</p>` +
    `<h1 style="margin:0 0 20px;font-size:20px;color:#18181b">${escapeHtml(heading)}</h1>` +
    htmlParagraphs +
    htmlCta +
    htmlFoot +
    `</div></body></html>`;

  const text = [
    heading,
    "",
    ...paragraphs,
    ...(cta ? ["", `${cta.label}: ${cta.url}`] : []),
    ...(footnote ? ["", footnote] : []),
  ].join("\n");

  return { subject, html, text };
}

export function inviteEmail(args: {
  name: string;
  roleName: string;
  link: string;
}): RenderedEmail {
  return render({
    subject: `You have been invited to ${APP_NAME}`,
    heading: "You are invited",
    paragraphs: [
      `Hi ${args.name || "there"},`,
      `An admin added you to ${APP_NAME} with the role ${args.roleName}. Set your password to finish creating your account.`,
    ],
    cta: { label: "Set your password", url: args.link },
    footnote:
      "This link works once and expires. If you did not expect this email, you can ignore it.",
  });
}

export function approvedEmail(args: {
  name: string;
  roleName: string;
  loginUrl: string;
}): RenderedEmail {
  return render({
    subject: `Your ${APP_NAME} account is approved`,
    heading: "You are approved",
    paragraphs: [
      `Hi ${args.name || "there"},`,
      `An admin approved your sign-up and gave you the role ${args.roleName}. You can sign in now.`,
    ],
    cta: { label: "Sign in", url: args.loginUrl },
  });
}

export function rejectedEmail(args: { name: string }): RenderedEmail {
  return render({
    subject: `Your ${APP_NAME} sign-up request`,
    heading: "Request not approved",
    paragraphs: [
      `Hi ${args.name || "there"},`,
      `An admin reviewed your sign-up request for ${APP_NAME} and did not approve it. If you think this is a mistake, contact an admin.`,
    ],
  });
}

export function resetEmail(args: { link: string }): RenderedEmail {
  return render({
    subject: `Reset your ${APP_NAME} password`,
    heading: "Reset your password",
    paragraphs: [
      "Use the button below to choose a new password for your account.",
    ],
    cta: { label: "Choose a new password", url: args.link },
    footnote:
      "This link works once and expires. If you did not ask for this, you can ignore it. Your password stays the same.",
  });
}
