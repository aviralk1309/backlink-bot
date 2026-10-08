import { expect, test } from "@playwright/test";

test("health ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
});
