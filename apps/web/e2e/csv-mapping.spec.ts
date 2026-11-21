import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { e2eAdminClient } from "./support/env";
import { login } from "./support/login";
import { runIngestion } from "./support/worker";
import { E2E_ADMIN, E2E_PASSWORD, seedE2e } from "./support/seed";

test.describe.configure({ mode: "serial" });

const JOB_PREFIX = "E2E mapping job ";

async function cleanup() {
  const admin = e2eAdminClient();
  const { data: jobs } = await admin
    .from("jobs")
    .select("id")
    .like("name", `${JOB_PREFIX}%`);
  const jobIds = (jobs ?? []).map((job) => job.id);
  for (const job of jobs ?? []) {
    const { data: objects, error } = await admin.storage
      .from("csv-uploads")
      .list(job.id);
    if (error) throw error;
    if (objects?.length) {
      const removed = await admin.storage
        .from("csv-uploads")
        .remove(objects.map((o) => `${job.id}/${o.name}`));
      if (removed.error) throw removed.error;
    }
  }
  await admin.from("jobs").delete().like("name", `${JOB_PREFIX}%`);
  if (jobIds.length) {
    const { error } = await admin
      .from("job_storage_cleanup")
      .delete()
      .in("job_id", jobIds);
    if (error) throw error;
  }
  await admin.from("mapping_templates").delete().like("name", "E2E %");
}

test.beforeAll(async () => {
  await seedE2e(e2eAdminClient());
  await cleanup();
});

test.afterEach(async () => {
  await cleanup();
});

test("upload a CSV, preview rows, map columns, and save a template", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const jobName = `${JOB_PREFIX}${stamp}`;
  const templateName = `E2E Template ${stamp}`;

  await login(page, E2E_ADMIN.email, E2E_PASSWORD);

  // 1. Create a draft job
  await page.goto("/jobs/new");
  await page.getByLabel("Job name").fill(jobName);
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?saved=created/);

  // 2. Open the Uploads tab
  await page.getByRole("link", { name: "Uploads" }).click();
  await expect(page).toHaveURL(/tab=uploads/);

  // 3. Upload a CSV file
  await page.locator("#csv-competitor").fill("rival-test.com");
  const extraRows = 20_000;
  const csvContent =
    "Source URL,Referring Page Title,Anchor Text,Domain Rating\n" +
    "https://example.com/blog/p1,First Article,great brand,42\n" +
    "https://example.com/blog/p2,Second Article,click here,55\n" +
    Array.from(
      { length: extraRows },
      (_, i) =>
        `https://example.com/blog/${i + 3},${"Article ".repeat(10)}${i},anchor,42\n`,
    ).join("");
  expect(Buffer.byteLength(csvContent)).toBeGreaterThan(2 * 1024 * 1024);

  await page.locator('input[type="file"]').setInputFiles({
    name: "backlinks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvContent, "utf8"),
  });

  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("File uploaded.")).toBeVisible();

  // 4. File appears in table with status 'Needs mapping'
  const fileRow = page.getByRole("row").filter({ hasText: "backlinks.csv" });
  await expect(fileRow).toBeVisible();
  await expect(fileRow).toContainText("Needs mapping");

  // 5. Click 'Map columns'
  await fileRow.getByRole("button", { name: "Map columns" }).click();
  await expect(
    page.getByRole("heading", { name: "Map columns" }),
  ).toBeVisible();

  // 6. Verify preview table and auto-guessed URL column
  await expect(page.locator("#csv-url-column")).toHaveValue("0");
  await expect(page.getByText("First Article").first()).toBeVisible();
  await expect(page.getByText("1 preview row")).toBeVisible();

  // 7. Configure extra columns and save as reusable template
  await page
    .getByRole("checkbox", {
      name: "Save this mapping as a reusable template",
    })
    .check();
  await page.getByLabel("Template name").fill(templateName);

  // 8. Save mapping
  await page.getByRole("button", { name: "Save mapping" }).click();

  // 9. Status transitions to 'Waiting to be read' (mapped)
  await expect(fileRow).toContainText("Waiting to be read");

  // 10. Open mapping again to verify saved template appears in template dropdown
  await fileRow.getByRole("button", { name: "Map columns" }).click();
  await expect(
    page.getByRole("heading", { name: "Map columns" }),
  ).toBeVisible();
  await expect(page.locator("#csv-mapping-template")).toBeVisible();
  await expect(page.locator("#csv-mapping-template")).toContainText(
    templateName,
  );

  // Cancel out
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await expect(page.getByRole("heading", { name: "Map columns" })).toHaveCount(
    0,
  );

  const jobId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1];
  await runIngestion("csv", jobId);
  const { data: processed, error: processingError } = await e2eAdminClient()
    .from("csv_uploads")
    .select("status, total_rows, valid_rows")
    .eq("job_id", jobId)
    .single();
  expect(processingError).toBeNull();
  expect(processed).toMatchObject({
    status: "ready",
    total_rows: extraRows + 2,
    valid_rows: extraRows + 2,
  });
});

test("complete lifecycle: upload, map, confirm, gap preview, and start job", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const jobName = `${JOB_PREFIX}lifecycle ${stamp}`;

  await login(page, E2E_ADMIN.email, E2E_PASSWORD);

  // 1. Create a draft with no paid or manually configured discovery source.
  await page.goto("/jobs/new");
  await page.getByLabel("Job name").fill(jobName);
  await page.getByLabel("Client domain").fill("myclient.com");
  await page.getByLabel("Business type").fill("SaaS tech blog");
  await page.locator("#job_country").selectOption({ label: "India" });
  await page.locator("#job_language").selectOption({ label: "English" });
  await page.getByRole("checkbox", { name: "Guest post" }).check();
  await page.getByLabel("Seed keywords").fill("tech blog backlinks");
  await page.getByLabel("Seed keywords").press("Enter");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?saved=created/);
  await expect(page.getByText(/Add a source:/)).toBeVisible();
  const jobId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1];

  // 2. Open the Uploads tab
  await page.getByRole("link", { name: "Uploads" }).click();
  await expect(page).toHaveURL(/tab=uploads/);

  // 3. Upload a competitor CSV file
  await page.locator("#csv-competitor").fill("rival-gap.com");
  const csvContent =
    "Target URL,Anchor\n" +
    "https://fresh-gap-site.com/best-review,top link\n" +
    "https://fresh-gap-site.com/best-review?utm_source=test,duplicate\n" +
    "bad-url,invalid\n";

  await page.locator('input[type="file"]').setInputFiles({
    name: "competitor_links.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvContent, "utf8"),
  });

  await page.getByRole("button", { name: "Upload file" }).click();
  await expect(page.getByText("File uploaded.")).toBeVisible();

  const fileRow = page
    .getByRole("row")
    .filter({ hasText: "competitor_links.csv" });
  await expect(fileRow).toBeVisible();

  // 4. Map columns
  await fileRow.getByRole("button", { name: "Map columns" }).click();
  await expect(
    page.getByRole("heading", { name: "Map columns" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(fileRow).toContainText("Waiting to be read");

  // Real Storage download, validation, staging and report upload.
  const admin = e2eAdminClient();
  await runIngestion("csv", jobId);
  const { data: upload, error } = await admin
    .from("csv_uploads")
    .select(
      "id, status, total_rows, valid_rows, invalid_rows, duplicate_rows, error_report_path",
    )
    .eq("job_id", jobId)
    .single();
  expect(error).toBeNull();
  expect(upload).toMatchObject({
    status: "ready",
    total_rows: 3,
    valid_rows: 2,
    invalid_rows: 1,
    duplicate_rows: 1,
  });
  expect(upload!.error_report_path).toBeTruthy();
  const report = await admin.storage
    .from("csv-uploads")
    .download(upload!.error_report_path!);
  expect(report.error).toBeNull();
  expect(await report.data!.text()).toContain("bad-url,bad_url");

  // 6. The Uploads tab refreshes the worker's status without a manual reload.
  await expect(fileRow).toContainText("Ready to confirm", {
    timeout: 15_000,
  });

  // 7. Click 'Review summary' and confirm file
  await fileRow.getByRole("button", { name: "Review summary" }).click();
  await expect(
    page.getByRole("heading", { name: "competitor_links.csv" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("File confirmed.")).toBeVisible();

  // 8. File row now displays 'Confirmed'
  await expect(fileRow).toContainText("Confirmed");
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to start" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Uploads" }).click();

  // 9. Pre-start Gap Preview panel displays gap domain and missing client warning
  await expect(page.getByText("Pre-start Gap Preview")).toBeVisible();
  await expect(
    page.getByText("No client backlink file uploaded"),
  ).toBeVisible();

  // 10. Start the job
  await page.getByRole("button", { name: "Start job" }).click();
  await page.getByRole("button", { name: "Yes, start job" }).click();

  await expect(page.getByText(/Job started\./)).toBeVisible();
  await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();

  // Real atomic job pickup imports confirmed CSV sources into opportunities.
  await runIngestion("job", jobId);
  const { data: opportunities, error: importError } = await admin
    .from("opportunities")
    .select("id, normalized_url, first_source_type")
    .eq("job_id", jobId);
  expect(importError).toBeNull();
  expect(opportunities).toHaveLength(1);
  expect(opportunities![0]).toMatchObject({
    normalized_url: "https://fresh-gap-site.com/best-review",
    first_source_type: "competitor_csv",
  });
  await page.reload();
  await expect(
    page.getByText("Running", { exact: true }).first(),
  ).toBeVisible();
});

test("all-invalid CSV stays reviewable but cannot be confirmed", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/jobs/new");
  await page.getByLabel("Job name").fill(`${JOB_PREFIX}invalid ${Date.now()}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?saved=created/);
  const jobId = /\/jobs\/([0-9a-f-]{36})/.exec(page.url())![1];

  await page.getByRole("link", { name: "Uploads" }).click();
  await page.locator("#csv-competitor").fill("invalid-export.com");
  await page
    .locator('input[type="file"]')
    .setInputFiles(
      resolve(process.cwd(), "../../fixtures/manual-ui/04-all-invalid.csv"),
    );
  await page.getByRole("button", { name: "Upload file" }).click();
  const fileRow = page
    .getByRole("row")
    .filter({ hasText: "04-all-invalid.csv" });
  await expect(fileRow).toContainText("Needs mapping");
  await fileRow.getByRole("button", { name: "Map columns" }).click();
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(fileRow).toContainText("Waiting to be read");

  await runIngestion("csv", jobId);
  await page.reload();
  await expect(fileRow).toContainText("No usable rows");
  await fileRow.getByRole("button", { name: "Review summary" }).click();
  await expect(
    page.getByText(/no usable rows.*upload a corrected file/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm import" }),
  ).toHaveCount(0);

  const { data: upload } = await e2eAdminClient()
    .from("csv_uploads")
    .select("status, valid_rows")
    .eq("job_id", jobId)
    .single();
  expect(upload).toMatchObject({ status: "ready", valid_rows: 0 });
});
