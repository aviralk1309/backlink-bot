import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { e2eAdminClient } from "./support/env";
import { login } from "./support/login";
import { E2E_ADMIN, E2E_PASSWORD, E2E_USER, seedE2e } from "./support/seed";
import { runIngestion } from "./support/worker";

const firstUrl = "https://e2e-review.example/first";
const secondUrl = "https://e2e-review.example/second";
const scoreBreakdown = {
  algorithm_version: 1,
  scoring_config_version: 1,
  components: [
    "relevance",
    "language_region",
    "activity_fit",
    "overlap",
    "multi_query",
    "spam_penalty",
  ].map((component) => ({ component, raw: 0 })),
};
let jobId: string;
let firstId: string;
let secondId: string;

test.beforeAll(async () => {
  const admin = e2eAdminClient();
  await seedE2e(admin);
  const job = await admin
    .from("jobs")
    .insert({ name: `E2E review job ${Date.now()}` })
    .select("id")
    .single();
  if (job.error || !job.data) throw job.error ?? new Error("Job not created");
  jobId = job.data.id;
  firstId = crypto.randomUUID();
  secondId = crypto.randomUUID();
  const rows = [
    { id: firstId, url: firstUrl, score: 90, tier: "high" },
    { id: secondId, url: secondUrl, score: 70, tier: "medium" },
  ].map(({ id, url, score, tier }) => ({
    id,
    job_id: jobId,
    original_url: url,
    normalized_url: url,
    host: "e2e-review.example",
    domain: "e2e-review.example",
    first_source_type: "seed_list",
    config_version: 1,
    check_status: "running",
    locked_by: "e2e-review",
    lease_expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    attempts: 1,
    score,
    tier,
    score_breakdown: scoreBreakdown,
  }));
  const inserted = await admin.from("opportunities").insert(rows);
  if (inserted.error) throw inserted.error;
  await runIngestion("review", jobId);
});

test.afterAll(async () => {
  if (!jobId) return;
  const admin = e2eAdminClient();
  const removed = await admin.from("jobs").delete().eq("id", jobId);
  if (removed.error) throw removed.error;
  const cleanup = await admin
    .from("job_storage_cleanup")
    .delete()
    .eq("job_id", jobId);
  if (cleanup.error) throw cleanup.error;
});

test("review results, view their report, export them, and enforce Viewer access", async ({
  page,
  browser,
}) => {
  const admin = e2eAdminClient();
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto(`/jobs/${jobId}?tab=results`);
  const results = page.getByRole("region", { name: "Results" });
  await expect(results.locator("tbody tr").first()).toContainText(firstUrl);
  await results.getByRole("link", { name: firstUrl }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "Start review" }).click();
  await expect
    .poll(async () => {
      const row = await admin
        .from("opportunities")
        .select("review_status")
        .eq("id", firstId)
        .single();
      return row.data?.review_status;
    })
    .toBe("in_review");

  await page.goto(`/jobs/${jobId}?tab=results&detail=${firstId}`);
  await drawer.getByRole("textbox", { name: "Notes" }).fill("=1+1");
  await drawer.getByRole("button", { name: "Save notes and metrics" }).click();
  await expect
    .poll(async () => {
      const row = await admin
        .from("opportunities")
        .select("notes")
        .eq("id", firstId)
        .single();
      return row.data?.notes;
    })
    .toBe("=1+1");
  await page.goto(`/jobs/${jobId}?tab=results&detail=${firstId}`);
  await drawer.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`detail=${secondId}`));
  await expect
    .poll(async () => {
      const row = await admin
        .from("opportunities")
        .select("review_status,notes")
        .eq("id", firstId)
        .single();
      return row.data;
    })
    .toMatchObject({ review_status: "approved", notes: "=1+1" });

  await drawer.getByRole("button", { name: "Start review" }).click();
  await expect
    .poll(async () => {
      const row = await admin
        .from("opportunities")
        .select("review_status")
        .eq("id", secondId)
        .single();
      return row.data?.review_status;
    })
    .toBe("in_review");
  await page.goto(`/jobs/${jobId}?tab=results&detail=${secondId}`);
  await drawer.getByRole("button", { name: "Reject", exact: true }).click();
  await drawer.getByLabel("Reject reason").selectOption("no_link_option");
  await drawer.getByRole("button", { name: "Confirm rejection" }).click();
  await expect
    .poll(async () => {
      const row = await admin
        .from("opportunities")
        .select("review_status,reject_reason,reject_scope")
        .eq("id", secondId)
        .single();
      return row.data;
    })
    .toMatchObject({
      review_status: "rejected",
      reject_reason: "no_link_option",
      reject_scope: "job",
    });

  await page.goto(`/jobs/${jobId}?tab=report`);
  const jobReport = page.getByRole("region", { name: "Report" });
  const jobHeadline = jobReport
    .getByText("First-Ready approval rate")
    .locator("..");
  await expect(jobHeadline).toContainText("50.0%");
  await expect(jobHeadline).toContainText("1 approved + 0 used / 2 decided");
  await expect(
    jobReport.getByText("Small sample: fewer than 20 decisions."),
  ).toBeVisible();
  await expect(
    jobReport.getByRole("row", { name: /no link option\s+1/ }),
  ).toBeVisible();

  await page.goto(`/reports?job=${jobId}`);
  const overallReport = page.getByRole("region", { name: "Report" });
  await expect(
    overallReport.getByText("First-Ready approval rate").locator(".."),
  ).toContainText("50.0%");

  await page.goto(`/jobs/${jobId}?tab=results`);
  const exportPanel = results
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Export CSV" }) });
  await exportPanel.locator("summary").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportPanel.getByRole("button", { name: "Download CSV" }).click(),
  ]);
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain(firstUrl);
  expect(csv).toContain(secondUrl);
  expect(csv).toContain('"\'=1+1"');
  expect(csv).toContain("approved");
  expect(csv).toContain("rejected");
  const events = await admin
    .from("job_events")
    .select("id")
    .eq("job_id", jobId)
    .eq("type", "results_export_started");
  expect(events.error).toBeNull();
  expect(events.data).toHaveLength(1);

  const viewer = await browser.newPage();
  try {
    await login(viewer, E2E_USER.email, E2E_PASSWORD);
    await viewer.goto(`/jobs/${jobId}?tab=results`);
    const viewerResults = viewer.getByRole("region", { name: "Results" });
    await expect(
      viewerResults.getByRole("link", { name: firstUrl }),
    ).toBeVisible();
    await expect(viewerResults.getByText("Export CSV")).toHaveCount(0);
    await viewerResults.getByRole("link", { name: firstUrl }).click();
    await expect(
      viewer
        .getByRole("dialog")
        .getByRole("button", { name: "Reopen for review" }),
    ).toHaveCount(0);
    const response = await viewer.request.post(
      `/api/jobs/${jobId}/results/export`,
      {
        form: {
          queue: "ready",
          export_status: "current",
          column: "normalized_url",
        },
      },
    );
    expect(response.status()).toBe(403);
    await viewer.goto(`/reports?job=${jobId}`);
    await expect(
      viewer
        .getByRole("region", { name: "Report" })
        .getByText("First-Ready approval rate")
        .locator(".."),
    ).toContainText("50.0%");
    await viewer.goto(`/jobs/${jobId}?tab=report`);
    await expect(
      viewer
        .getByRole("region", { name: "Report" })
        .getByText("First-Ready approval rate")
        .locator(".."),
    ).toContainText("50.0%");
    const reportExport = await viewer.request.get(
      `/api/reports/export?job=${jobId}`,
    );
    expect(reportExport.status()).toBe(200);
    expect(await reportExport.text()).toContain("top_50");
  } finally {
    await viewer.close();
  }
});
