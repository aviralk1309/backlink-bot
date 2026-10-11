import { expect, test } from "@playwright/test";
import { e2eAdminClient, e2eAnonClient } from "./support/env";
import { login } from "./support/login";
import {
  ADMIN_ROLE_ID,
  E2E_ADMIN,
  E2E_PASSWORD,
  E2E_ROLE_PREFIX,
  E2E_USER,
  MANAGER_ROLE_ID,
  VIEWER_ROLE_ID,
  seedE2e,
} from "./support/seed";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedE2e(e2eAdminClient());
});

test("signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/admin/roles");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Froles/);
});

test("Admin lands on the first admin section", async ({ page }) => {
  await login(page, E2E_ADMIN.email, E2E_PASSWORD);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/users/);
});

test("Viewer sees no Admin link and gets No access on every admin page", async ({
  page,
}) => {
  await login(page, E2E_USER.email, E2E_PASSWORD);

  await expect(page.getByRole("link", { name: "Jobs" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveCount(0);

  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/roles",
    "/admin/roles/new",
    `/admin/roles/${MANAGER_ROLE_ID}`,
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "No access" }),
      `${path} should show No access`,
    ).toBeVisible();
    // The page must not leak the form or the table behind the message.
    await expect(page.getByRole("button", { name: "Save role" })).toHaveCount(
      0,
    );
  }
});

test("a Viewer cannot change roles or accounts through the API", async () => {
  const admin = e2eAdminClient();
  const api = e2eAnonClient();

  const signIn = await api.auth.signInWithPassword({
    email: E2E_USER.email,
    password: E2E_PASSWORD,
  });
  expect(signIn.error).toBeNull();

  const directName = `${E2E_ROLE_PREFIX}direct`;

  // Writes the database must refuse outright.
  const insert = await api.from("roles").insert({ name: directName });
  expect(insert.error?.code).toBe("42501");

  const save = await api.rpc("save_role", {
    p_role_id: null,
    p_name: directName,
    p_description: null,
    p_permission_keys: ["jobs.view"],
  });
  expect(save.error?.code).toBe("42501");

  // Reads and updates RLS filters to nothing, without an error.
  const counts = await api.rpc("role_user_counts");
  expect(counts.error).toBeNull();
  expect(counts.data).toEqual([]);

  const me = await admin
    .from("profiles")
    .select("id")
    .eq("email", E2E_USER.email)
    .single();
  const myId = me.data?.id as string;
  expect(myId).toBeTruthy();

  const escalate = await api
    .from("profiles")
    .update({ role_id: ADMIN_ROLE_ID })
    .eq("id", myId)
    .select();
  expect(escalate.error).toBeNull();
  expect(escalate.data).toEqual([]);

  const remove = await api
    .from("roles")
    .delete()
    .eq("id", MANAGER_ROLE_ID)
    .select();
  expect(remove.data).toEqual([]);

  // Do not trust the responses: look at the data with the service key.
  const after = await admin
    .from("profiles")
    .select("role_id")
    .eq("id", myId)
    .single();
  expect(after.data?.role_id).toBe(VIEWER_ROLE_ID);

  const manager = await admin
    .from("roles")
    .select("id")
    .eq("id", MANAGER_ROLE_ID)
    .maybeSingle();
  expect(manager.data).not.toBeNull();

  const leftovers = await admin.from("roles").select("id").eq("name", directName);
  expect(leftovers.data).toEqual([]);

  await api.auth.signOut();
});