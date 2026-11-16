import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requirePermission: mocks.permission,
  AuthError: class AuthError extends Error {},
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/auth/schemas", async () => import("../../lib/auth/schemas"));
vi.mock("@/lib/db-errors", async () => import("../../lib/db-errors"));

import { AuthError } from "@/lib/auth/session";
import { rescoreJobAction } from "./actions";

const id = "97000000-0000-4000-8000-000000000001";
function form(confirmed = true) {
  const data = new FormData();
  data.set("job_id", id);
  if (confirmed) data.set("confirmed", "yes");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({});
  mocks.rpc.mockResolvedValue({ data: id, error: null });
});
describe("explicit rescore action", () => {
  it("requires permission before accessing the database", async () => {
    mocks.permission.mockRejectedValue(new AuthError("forbidden"));
    expect((await rescoreJobAction({}, form())).error).toContain("permission");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires confirmation and a valid job id", async () => {
    expect((await rescoreJobAction({}, form(false))).error).toContain(
      "Confirm",
    );
    const invalid = form();
    invalid.set("job_id", "bad");
    expect((await rescoreJobAction({}, invalid)).error).toContain("Invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("queues only the confirmed job using server-captured settings", async () => {
    expect((await rescoreJobAction({}, form())).message).toContain("queued");
    expect(mocks.permission).toHaveBeenCalledWith("jobs.rescore");
    expect(mocks.rpc).toHaveBeenCalledWith("request_job_rescore", {
      p_job_id: id,
      p_confirmed: true,
    });
    expect(mocks.refresh).toHaveBeenCalledWith(`/jobs/${id}`);
  });
  it("explains the idle-job restriction", async () => {
    mocks.rpc.mockResolvedValue({
      error: { message: "rescore_requires_idle_finished_job" },
    });
    expect((await rescoreJobAction({}, form())).error).toContain(
      "no checks still running",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
