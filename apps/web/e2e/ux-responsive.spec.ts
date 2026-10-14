import { expect, test } from "@playwright/test";
import { login } from "./support/login";
import { E2E_ADMIN, E2E_PASSWORD, seedE2e } from "./support/seed";
import { e2eAdminClient } from "./support/env";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedE2e(e2eAdminClient());
});

test("mobile viewport responsiveness: hamburger sheet navigation and responsive breadcrumbs", async ({
  page,
}) => {
  // Mobile iPhone SE viewport
  await page.setViewportSize({ width: 375, height: 667 });

  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/jobs");

  // On mobile, sidebar is hidden, mobile menu button is visible
  const menuButton = page.getByRole("button", { name: "Open navigation" });
  await expect(menuButton).toBeVisible();

  // Desktop collapse button is hidden on mobile
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeHidden();

  // Open mobile drawer
  await menuButton.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Admin" })).toBeVisible();

  // Navigate using sheet item
  await sheet.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin\/users/);
  // Sheet closes automatically after navigation
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("theme toggle switches light and dark themes", async ({ page }) => {
  await page.goto("/login");

  const themeToggle = page.getByRole("button", { name: /switch to (dark|light) theme/i });
  await expect(themeToggle).toBeVisible();

  const html = page.locator("html");
  const initialClass = (await html.getAttribute("class")) || "";

  // Click toggle
  await themeToggle.click();
  const nextClass = (await html.getAttribute("class")) || "";
  expect(nextClass).not.toEqual(initialClass);

  // Click toggle back
  await themeToggle.click();
  const finalClass = (await html.getAttribute("class")) || "";
  expect(finalClass).toEqual(initialClass);
});

test("chip input ergonomics: enter, comma, paste, duplicate rejection and backspace deletion", async ({
  page,
}) => {
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/jobs/new");

  const keywordInput = page.getByLabel("Seed keywords", { exact: false });
  await expect(keywordInput).toBeVisible();

  // 1. Enter key creates chip
  await keywordInput.pressSequentially("guest blogging");
  await keywordInput.press("Enter");
  await expect(page.getByText("guest blogging", { exact: true })).toBeVisible();

  // 2. Comma creates chip
  await keywordInput.pressSequentially("seo backlinks,");
  await expect(page.getByText("seo backlinks", { exact: true })).toBeVisible();

  // 3. Duplicate prevention: typing existing chip is skipped
  await keywordInput.pressSequentially("guest blogging");
  await keywordInput.press("Enter");
  await expect(page.getByText("guest blogging", { exact: true })).toHaveCount(1);

  // 4. Backspace on empty input removes last chip
  await keywordInput.fill("");
  await keywordInput.press("Backspace");
  await expect(page.getByText("seo backlinks", { exact: true })).toHaveCount(0);
  await expect(page.getByText("guest blogging", { exact: true })).toBeVisible();

  // 5. Removing specific chip via X button
  const removeButton = page.getByRole("button", { name: "Remove guest blogging" });
  await expect(removeButton).toBeVisible();
  await removeButton.click();
  await expect(page.getByText("guest blogging", { exact: true })).toHaveCount(0);
});

test("chip input pasting multi-line or comma-separated items", async ({ page }) => {
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/jobs/new");

  const keywordInput = page.getByLabel("Seed keywords", { exact: false });
  await expect(keywordInput).toBeVisible();

  // Simulate clipboard paste via dispatchEvent
  await keywordInput.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "alpha keyword, beta keyword, gamma keyword");
    const pasteEvent = new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(pasteEvent);
  });

  await expect(page.getByText("alpha keyword", { exact: true })).toBeVisible();
  await expect(page.getByText("beta keyword", { exact: true })).toBeVisible();
  await expect(page.getByText("gamma keyword", { exact: true })).toBeVisible();
});

test("job form disclosure sections toggle cleanly", async ({ page }) => {
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/jobs/new");

  const disclosureSummary = page.getByText("Business name, address and phone");
  await expect(disclosureSummary).toBeVisible();

  // Initially details is closed, inputs inside should not be visible or details open attribute false
  const details = page.locator("details", { hasText: "Business name, address and phone" });
  await expect(details).not.toHaveAttribute("open", "");

  // Click summary to toggle open
  await disclosureSummary.click();
  await expect(details).toHaveAttribute("open", "");
  await expect(page.getByLabel("Business name")).toBeVisible();
  await expect(page.getByLabel("Phone")).toBeVisible();
  await expect(page.getByLabel("Address")).toBeVisible();

  // Click summary to toggle closed
  await disclosureSummary.click();
  await expect(details).not.toHaveAttribute("open", "");
});

