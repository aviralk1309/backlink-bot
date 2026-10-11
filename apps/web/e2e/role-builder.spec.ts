import { expect, test, type Page } from "@playwright/test";
import { e2eAdminClient } from "./support/env";
import { login } from "./support/login";
import {
  E2E_ADMIN,
  E2E_PASSWORD,
  E2E_ROLE_PREFIX,
  E2E_USER,
  seedE2e,
} from "./support/seed";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedE2e(e2eAdminClient());
});

const roleRow = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });

const userRow = (page: Page, email: string) =>
  page.getByRole("row").filter({ hasText: email });

async function assignRole(page: Page, email: string, roleLabel: string) {
  await page.goto("/admin/users");
  const row = userRow(page, email);
  await row.getByLabel(`Role for ${email}`).selectOption({ label: roleLabel });
  await row.getByRole("button", { name: "Change role" }).click();
  await expect(row.getByText("Role updated.")).toBeVisible();
}

test("Admin role keeps user and role management locked on", async ({
  page,
}) => {
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/admin/roles");
  await roleRow(page, "Admin").getByRole("link", { name: "Edit" }).click();

  for (const key of [/^roles\.manage/, /^users\.manage/]) {
    const box = page.getByRole("checkbox", { name: key });
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
  }
});

test("create, assign, restrict and delete a role", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const roleName = `${E2E_ROLE_PREFIX}${Date.now()}`;

  await test.step("admin creates a role with two permissions", async () => {
    await login(page, E2E_ADMIN.email, E2E_PASSWORD);
    await page.goto("/admin/roles/new");
    await page.getByLabel("Name", { exact: true }).fill(roleName);
    await page.getByRole("checkbox", { name: /^jobs\.view/ }).check();
    await page.getByRole("checkbox", { name: /^reports\.view/ }).check();
    await page.getByRole("button", { name: "Save role" }).click();

    await expect(page).toHaveURL(/saved=created/);
    await expect(page.getByText("Role created.")).toBeVisible();
    await expect(roleRow(page, roleName)).toContainText(/2 of \d+/);
  });

  await test.step("admin assigns it to the test user", async () => {
    await assignRole(page, E2E_USER.email, roleName);
  });

  await test.step("the user sees only what the role allows", async () => {
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
    });
    const userPage = await ctx.newPage();
    await login(userPage, E2E_USER.email, E2E_PASSWORD);

    await expect(userPage.getByRole("link", { name: "Jobs" })).toBeVisible();
    await expect(
      userPage.getByRole("link", { name: "Reports" }),
    ).toBeVisible();
    await expect(
      userPage.getByRole("link", { name: "Admin", exact: true }),
    ).toHaveCount(0);

    await userPage.goto("/admin/roles");
    await expect(
    userPage.getByRole("heading", { name: "No access" }),
    ).toBeVisible();
    await ctx.close();
  });

  await test.step("delete is blocked while a user holds the role", async () => {
    await page.goto("/admin/roles");
    await roleRow(page, roleName).getByRole("link", { name: "Edit" }).click();
    await expect(
      page.getByText(
        "1 user still has this role. Move them to another role first.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete role" }),
    ).toHaveCount(0);
  });

  await test.step("after moving the user away, delete works", async () => {
    await assignRole(page, E2E_USER.email, "Viewer");

    await page.goto("/admin/roles");
    await roleRow(page, roleName).getByRole("link", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Delete role" }).click();
    await page.getByRole("button", { name: "Yes, delete role" }).click();

    await expect(page).toHaveURL(/saved=deleted/);
    await expect(page.getByText("Role deleted.")).toBeVisible();
    await expect(page.getByText(roleName, { exact: true })).toHaveCount(0);
  });
});