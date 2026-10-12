import { expect, test, type Page } from "@playwright/test";
import { e2eAdminClient, e2eAnonClient } from "./support/env";
import { login } from "./support/login";
import { E2E_ADMIN, E2E_PASSWORD, E2E_USER, seedE2e } from "./support/seed";

test.describe.configure({ mode: "serial" });

// Next.js adds its own role="alert" route announcer to every page, so error
// messages are found by their element, not by role alone.

// Everything this file creates carries one of these markers, so a failed run
// is cleaned up the next time (and after the last test).
const JOB_PREFIX = "E2E job ";
const ACTIVITY_KEY_PREFIX = "e2e_activity_";
const DOMAIN_PREFIX = "e2e-";

async function cleanup() {
  const admin = e2eAdminClient();
  await admin.from("jobs").delete().like("name", `${JOB_PREFIX}%`);
  await admin
    .from("activity_profiles")
    .delete()
    .like("key", `${ACTIVITY_KEY_PREFIX}%`);
  await admin.from("blocklist").delete().like("domain", `${DOMAIN_PREFIX}%`);
}

test.beforeAll(async () => {
  await seedE2e(e2eAdminClient());
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
});

const jobIdFromUrl = (page: Page) => {
  const match = /\/jobs\/([0-9a-f-]{36})/.exec(page.url());
  if (!match?.[1]) throw new Error(`No job id in ${page.url()}`);
  return match[1];
};

const rowFor = (page: Page, text: string) =>
  page.getByRole("row").filter({ hasText: text });

// Opens an activity's edit page from the list and waits until it is really
// there. Next keeps recently visited pages in the DOM (hidden), so a field
// can already "exist" from the New page while the edit page is still loading.
async function openActivityEdit(page: Page, name: string) {
  await rowFor(page, name).getByRole("link", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: `Edit activity: ${name}` }),
  ).toBeVisible();
}

test("a draft can be saved half-empty and shows what is missing", async ({
  page,
}) => {
  const name = `${JOB_PREFIX}draft ${Date.now()}`;
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);

  await page.goto("/jobs/new");
  await page.getByLabel("Job name").fill(name);
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?saved=created/);
  await expect(page.getByText("Job created.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Before you can start" }),
  ).toBeVisible();
  await expect(page.getByText("Add the business type.")).toBeVisible();
  await expect(page.getByText("Choose at least one activity.")).toBeVisible();

  // Starting anyway is refused with the same list.
  await page.getByRole("button", { name: "Start job" }).click();
  await page.getByRole("button", { name: "Yes, start job" }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "This job cannot start yet.",
  );

  // The job is listed.
  await page.goto("/jobs");
  await expect(rowFor(page, name)).toContainText("Draft");
});

test("fill in a job, start it, stop it, then delete it", async ({ page }) => {
  test.setTimeout(120_000);
  const name = `${JOB_PREFIX}lifecycle ${Date.now()}`;
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);

  await test.step("create a complete draft", async () => {
    await page.goto("/jobs/new");
    await page.getByLabel("Job name").fill(name);
    await page.locator("#job_client_domain").fill("example.com");
    await page.getByLabel("Business type").fill("yoga studio");
    await page.locator("#job_country").selectOption({ label: "India" });
    await page.locator("#job_language").selectOption({ label: "English" });
    await page.getByRole("checkbox", { name: "Guest post" }).check();
    await page.getByLabel("Seed keywords").fill("yoga retreat");
    await page.getByLabel("Seed keywords").press("Enter");
    await page.getByLabel("Serper credit budget").fill("100");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.getByText("Job created.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ready to start" }),
    ).toBeVisible();
  });
  const id = jobIdFromUrl(page);

  await test.step("start it: it is queued until a worker exists", async () => {
    await page.getByRole("button", { name: "Start job" }).click();
    await expect(page.getByText(/up to 100 Serper credits/)).toBeVisible();
    await page.getByRole("button", { name: "Yes, start job" }).click();

    await expect(page.getByText(/Job started\./)).toBeVisible();
    await expect(
      page.getByText("Queued", { exact: true }).first(),
    ).toBeVisible();
    // A queued job cannot be deleted, and the page says why.
    await expect(
      page.getByText("Stop this job before deleting it."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete job" })).toHaveCount(
      0,
    );
  });

  await test.step("changing settings now creates a new version", async () => {
    await page.goto(`/jobs/${id}/edit`);
    await page.getByLabel("Serper credit budget").fill("150");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Job saved.")).toBeVisible();

    const { data } = await e2eAdminClient()
      .from("jobs")
      .select("config_version, status, budget_credits")
      .eq("id", id)
      .single();
    expect(data).toMatchObject({
      config_version: 2,
      status: "queued",
      budget_credits: 150,
    });
  });

  await test.step("stop it with a reason", async () => {
    await page.goto(`/jobs/${id}`);
    await page.getByRole("button", { name: "Stop job" }).click();
    await page.getByLabel("Reason for stopping (optional)").fill("E2E done");
    await page.getByRole("button", { name: "Yes, stop job" }).click();

    await expect(page.getByText(/Job stopped\./)).toBeVisible();
    await expect(
      page.getByText("Stopped", { exact: true }).first(),
    ).toBeVisible();
    // Finished jobs are read-only.
    await expect(page.getByRole("link", { name: "Edit settings" })).toHaveCount(
      0,
    );
  });

  await test.step("the activity log tells the story", async () => {
    await page.goto(`/jobs/${id}?tab=activity`);
    const log = page.getByRole("list", { name: "Job activity" });
    await expect(log).toContainText("Created the job.");
    await expect(log).toContainText("Started the job.");
    await expect(log).toContainText("Stopped the job: E2E done");
  });

  await test.step("a stopped job can be deleted", async () => {
    await page.goto(`/jobs/${id}`);
    await page.getByRole("button", { name: "Delete job" }).click();
    await page.getByRole("button", { name: "Yes, delete job" }).click();

    await expect(page).toHaveURL(/\/jobs\?saved=deleted/);
    await expect(page.getByText("Job deleted.")).toBeVisible();

    // Ask the database first: was it really deleted?
    const { data } = await e2eAdminClient()
      .from("jobs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(data, "the job should be gone from the database").toBeNull();

    // Then the list: it must not show it either.
    await expect(rowFor(page, name)).toHaveCount(0);
  });
});

test("the list filters by search text and status", async ({ page }) => {
  const stamp = Date.now();
  const first = `${JOB_PREFIX}filter-one ${stamp}`;
  const second = `${JOB_PREFIX}filter-two ${stamp}`;
  // Seeded with the service key: this test is about the list, not the form.
  await e2eAdminClient()
    .from("jobs")
    .insert([{ name: first }, { name: second }]);

  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto(`/jobs?q=${encodeURIComponent(`filter-one ${stamp}`)}`);
  await expect(rowFor(page, first)).toBeVisible();
  await expect(rowFor(page, second)).toHaveCount(0);

  await page.goto(`/jobs?status=running&q=${stamp}`);
  await expect(page.getByText("No jobs match these filters.")).toBeVisible();
});

test("a Viewer can read jobs but not create, change or control them", async ({
  page,
}) => {
  const admin = e2eAdminClient();
  const name = `${JOB_PREFIX}viewer-check ${Date.now()}`;
  const { data: created } = await admin
    .from("jobs")
    .insert({ name })
    .select("id")
    .single();
  const id = created?.id as string;
  expect(id).toBeTruthy();

  await test.step("the screens hide what the Viewer cannot do", async () => {
    await login(page, E2E_USER.email, E2E_PASSWORD);

    await page.goto("/jobs");
    await expect(rowFor(page, name)).toBeVisible();
    await expect(page.getByRole("link", { name: "New job" })).toHaveCount(0);

    await page.goto("/jobs/new");
    await expect(
      page.getByRole("heading", { name: "No access" }),
    ).toBeVisible();
    await page.goto(`/jobs/${id}/edit`);
    await expect(
      page.getByRole("heading", { name: "No access" }),
    ).toBeVisible();

    await page.goto(`/jobs/${id}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    for (const button of ["Start job", "Delete job"]) {
      await expect(page.getByRole("button", { name: button })).toHaveCount(0);
    }
    await expect(page.getByRole("link", { name: "Edit settings" })).toHaveCount(
      0,
    );

    for (const path of ["/admin/activities", "/admin/blocklist"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "No access" }),
        `${path} should show No access`,
      ).toBeVisible();
    }
  });

  await test.step("the API refuses the same things", async () => {
    const api = e2eAnonClient();
    const signIn = await api.auth.signInWithPassword({
      email: E2E_USER.email,
      password: E2E_PASSWORD,
    });
    expect(signIn.error).toBeNull();

    const insert = await api.from("jobs").insert({ name: `${JOB_PREFIX}api` });
    expect(insert.error?.code).toBe("42501");

    const start = await api.rpc("transition_job", {
      p_job_id: id,
      p_action: "start",
    });
    expect(start.error).not.toBeNull();

    const edit = await api
      .from("jobs")
      .update({ name: `${JOB_PREFIX}hijacked` })
      .eq("id", id)
      .select();
    expect(edit.data ?? []).toEqual([]);

    const activity = await api.from("activity_profiles").insert({
      key: `${ACTIVITY_KEY_PREFIX}api`,
      name: "API",
    });
    expect(activity.error?.code).toBe("42501");

    // The blocklist is invisible without blocklist.manage.
    await admin
      .from("blocklist")
      .insert({ domain: `${DOMAIN_PREFIX}viewer-check.com` });
    const list = await api.from("blocklist").select("domain");
    expect(list.error).toBeNull();
    expect(list.data).toEqual([]);

    // Do not trust the responses: look at the data with the service key.
    const after = await admin
      .from("jobs")
      .select("name, status")
      .eq("id", id)
      .single();
    expect(after.data).toEqual({ name, status: "draft" });

    await api.auth.signOut();
  });
});

test("Admin creates and edits an activity, and versions only real changes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const name = `E2E activity ${Date.now()}`;
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);

  await test.step("the seeded activities are there", async () => {
    await page.goto("/admin/activities");
    await expect(rowFor(page, "Guest post")).toBeVisible();
    await expect(rowFor(page, "Resource page")).toBeVisible();
  });

  await test.step("create one: the key is suggested from the name", async () => {
    await page.getByRole("link", { name: "New activity" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await expect(page.getByLabel("Key", { exact: true })).toHaveValue(
      /^e2e_activity_\d+$/,
    );
    await page.getByRole("button", { name: "Save activity" }).click();

    await expect(page).toHaveURL(/saved=created/);
    await expect(page.getByText("Activity created.")).toBeVisible();
    await expect(rowFor(page, name)).toContainText("Enabled");
  });

  await test.step("scoring weights that do not add up are refused", async () => {
    await openActivityEdit(page, name);
    await page.locator("#w_relevance:visible").fill("40");
    await expect(page.getByText("Total: 105 of 100")).toBeVisible();
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("add up to 100");
  });

  await test.step("a bad template is flagged as you type", async () => {
    await page.locator("#w_relevance:visible").fill("35");
    await page.locator('input[aria-label="Search text for template 1"]:visible').fill("{keywrd}");
    await expect(
      page.getByRole("alert").filter({ hasText: "{keywrd}" }),
    ).toBeVisible();
    await page.locator('input[aria-label="Search text for template 1"]:visible').fill("{keyword}");
  });

  const versionOf = async () => {
    const { data } = await e2eAdminClient()
      .from("activity_profiles")
      .select("version")
      .like("key", `${ACTIVITY_KEY_PREFIX}%`)
      .eq("name", name)
      .single();
    return data?.version as number;
  };

  await test.step("saving with no change keeps version 1", async () => {
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.getByText("Activity saved.")).toBeVisible();
    expect(await versionOf()).toBe(1);
  });

  await test.step("a real change makes version 2", async () => {
    await openActivityEdit(page, name);
    await page.locator("#per_domain_cap:visible").fill("7");
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.getByText("Activity saved.")).toBeVisible();
    expect(await versionOf()).toBe(2);
  });

  await test.step("a disabled activity cannot be chosen for a new job", async () => {
    await openActivityEdit(page, name);
    await page.getByRole("checkbox", { name: /^Enabled/ }).uncheck();
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(rowFor(page, name)).toContainText("Disabled");

    await page.goto("/jobs/new");
    await expect(page.getByRole("checkbox", { name })).toHaveCount(0);
  });
});

test("Admin manages the blocklist in bulk", async ({ page }) => {
  const stamp = Date.now();
  const a = `${DOMAIN_PREFIX}${stamp}-a.com`;
  const b = `${DOMAIN_PREFIX}${stamp}-b.com`;
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/admin/blocklist");
  const domains = page.getByLabel("Domains to block");

  await test.step("a typo stops the batch and keeps what was typed", async () => {
    await domains.fill(`${a} notadomain`);
    await page.getByRole("button", { name: "Block domains" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("notadomain");
    await expect(domains).toHaveValue(`${a} notadomain`);
    await expect(rowFor(page, a)).toHaveCount(0);
  });

  await test.step("a pasted list is cleaned and added", async () => {
    await domains.fill(`https://www.${a}/some/page, ${b}`);
    await page.locator("#block_reason").fill("E2E spam");
    await page.getByRole("button", { name: "Block domains" }).click();
    await expect(page.getByText("Added 2 domains.")).toBeVisible();
    await expect(rowFor(page, a)).toContainText("E2E spam");
    await expect(rowFor(page, b)).toBeVisible();
    await expect(domains).toHaveValue("");
  });

  await test.step("adding a known domain is skipped, not an error", async () => {
    await domains.fill(a);
    await page.getByRole("button", { name: "Block domains" }).click();
    await expect(
      page.getByText("That domain was already blocked."),
    ).toBeVisible();
  });

  await test.step("edit a reason", async () => {
    await page.getByRole("button", { name: `Edit reason for ${a}` }).click();
    await page.getByLabel(`Reason for blocking ${a}`).fill("E2E updated");
    await rowFor(page, a).getByRole("button", { name: "Save" }).click();
    await expect(rowFor(page, a)).toContainText("E2E updated");
  });

  await test.step("search finds it, remove asks first", async () => {
    await page.goto(`/admin/blocklist?q=${stamp}`);
    await expect(rowFor(page, a)).toBeVisible();

    await page.getByRole("button", { name: `Remove ${a}` }).click();
    await page.getByRole("button", { name: "Yes, remove" }).click();
    await expect(rowFor(page, a)).toHaveCount(0);
    await expect(rowFor(page, b)).toBeVisible();
  });
});