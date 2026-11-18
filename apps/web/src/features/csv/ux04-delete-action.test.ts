import { expect, it, vi } from "vitest";

const { remove, rpc, pendingLookup, acknowledge } = vi.hoisted(() => ({
  remove: vi
    .fn()
    .mockResolvedValue({ error: { message: "Storage unavailable" } }),
  rpc: vi.fn().mockResolvedValue({ data: "job/upload.csv", error: null }),
  pendingLookup: vi.fn().mockResolvedValue({
    data: [{ path: "job/upload.csv" }],
    error: null,
  }),
  acknowledge: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  AuthError: class AuthError extends Error {},
  requirePermission: vi.fn().mockResolvedValue({ userId: "reviewer" }),
}));
vi.mock("@/lib/auth/schemas", () => ({ firstIssue: () => "invalid" }));
vi.mock("@/lib/db-errors", () => ({
  describeDbError: (message: string) => message,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc,
    storage: { from: () => ({ remove }) },
    from: () => ({
      select: () => ({ eq: () => ({ limit: pendingLookup }) }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ delete: () => ({ eq: acknowledge }) }),
  }),
}));
vi.mock("./queries", () => ({}));

import { deleteCsvUploadAction } from "./actions";

it("UX-04 reports Storage deletion failure instead of success", async () => {
  const form = new FormData();
  form.set("job_id", "00000000-0000-4000-8000-000000000001");
  form.set("upload_id", "00000000-0000-4000-8000-000000000002");

  const result = await deleteCsvUploadAction(form);

  expect(rpc).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith(["job/upload.csv"]);
  expect(result.message).toMatch(/cleanup pending/i);
  expect(acknowledge).not.toHaveBeenCalled();
});

it("UX-04 acknowledges a successful Storage removal", async () => {
  remove.mockResolvedValueOnce({ error: null });
  pendingLookup.mockResolvedValueOnce({ data: [], error: null });
  const form = new FormData();
  form.set("job_id", "00000000-0000-4000-8000-000000000001");
  form.set("upload_id", "00000000-0000-4000-8000-000000000002");

  const result = await deleteCsvUploadAction(form);

  expect(acknowledge).toHaveBeenCalledWith("path", "job/upload.csv");
  expect(result.message).toBe("File deleted.");
});
