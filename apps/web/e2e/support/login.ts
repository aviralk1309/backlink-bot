import type { Page } from "@playwright/test";

/**
 * Signs in through the real form. Every step has its own timeout, and a
 * failure reports the URL and any alert text on the page, so a wrong
 * password, a slow server and a stuck request look different.
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/^email$/i).fill(email);
  await page.getByLabel(/^password$/i).fill(password);
  // noWaitAfter: do not block on the navigation the click starts. The wait
  // below has its own timeout and a useful error.
  await page
    .getByRole("button", { name: /sign in|log in/i })
    .click({ noWaitAfter: true });

  try {
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 25_000,
    });
  } catch (err) {
    const alerts = (
      await page
        .getByRole("alert")
        .allInnerTexts()
        .catch(() => [] as string[])
    )
      .map((t) => t.trim())
      .filter(Boolean);
    throw new Error(
      `Login did not leave /login for ${email}. URL: ${page.url()}. Page alerts: ${
        alerts.join(" | ") || "none"
      }`,
      { cause: err },
    );
  }
}