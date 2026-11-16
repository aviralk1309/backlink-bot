import type { Page, Request } from "@playwright/test";

/** Real form login, with bounded diagnostics for hydration and auth failures. */
export async function login(page: Page, email: string, password: string) {
  const diagnostics: string[] = [];
  const record = (message: string) => {
    if (diagnostics.length < 10) diagnostics.push(message.slice(0, 400));
  };
  const onError = (error: Error) => record(`Browser error: ${error.message}`);
  const onFailed = (request: Request) =>
    record(
      `Request failed: ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
    );
  page.on("pageerror", onError);
  page.on("requestfailed", onFailed);
  try {
    await page.goto("/login");
    await page.locator('form[data-hydrated="true"]').waitFor({
      state: "attached",
      timeout: 45_000,
    });
    await page.getByLabel(/^email$/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page
      .getByRole("button", { name: /sign in|log in/i })
      .click({ noWaitAfter: true });
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
      .map((text) => text.trim())
      .filter(Boolean);
    throw new Error(
      `Login failed for ${email}. URL: ${page.url()}. Alerts: ${alerts.join(" | ") || "none"}. ` +
        `Diagnostics: ${diagnostics.join(" | ") || "none"}. See retained Playwright trace.`,
      { cause: err },
    );
  } finally {
    page.off("pageerror", onError);
    page.off("requestfailed", onFailed);
  }
}
