import { expect, it, vi } from "vitest";

const { generateLink, update, callerUpdate, canAssign } = vi.hoisted(() => ({
  generateLink: vi.fn().mockResolvedValue({
    data: { user: { id: "new-user" }, properties: { hashed_token: "token" } },
    error: null,
  }),
  update: vi.fn(),
  callerUpdate: vi.fn().mockReturnValue({
    eq: () => ({
      select: async () => ({ data: [{ id: "new-user" }], error: null }),
    }),
  }),
  canAssign: vi.fn().mockResolvedValue({ data: false, error: null }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  AuthError: class AuthError extends Error {},
  // The actor holds users.manage but does not hold roles.manage or Admin.
  requirePermission: vi.fn().mockResolvedValue({ userId: "limited-manager" }),
}));
vi.mock("@/lib/auth/schemas", () => ({}));
vi.mock("@/lib/db-errors", () => ({
  describeDbError: (message: string) => message,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: canAssign,
    from: (table: string) =>
      table === "roles"
        ? {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { name: "Admin" } }),
              }),
            }),
          }
        : { update: callerUpdate },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { generateLink } },
    from: () => ({
      update: (...args: unknown[]) => {
        update(...args);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));
vi.mock("@/lib/mail/send", () => ({
  appUrl: (path: string) => path,
  sendMail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/mail/templates", () => ({
  inviteEmail: () => ({}),
  approvedEmail: () => ({}),
  rejectedEmail: () => ({}),
  resetEmail: () => ({}),
}));

import { inviteUserAction } from "./actions";

it("S-01 users.manage-only actor cannot invite an Admin", async () => {
  const form = new FormData();
  form.set("full_name", "New Admin");
  form.set("email", "new-admin@test.local");
  form.set("role_id", "a0000000-0000-0000-0000-000000000001");

  const result = await inviteUserAction({}, form);

  expect(result).toHaveProperty("error");
  expect(canAssign).toHaveBeenCalledWith("can_assign_role", {
    p_role_id: "a0000000-0000-0000-0000-000000000001",
  });
  expect(generateLink).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(callerUpdate).not.toHaveBeenCalled();
});

it("S-01 allowed invitation updates the profile as the caller", async () => {
  canAssign.mockResolvedValueOnce({ data: true, error: null });
  const form = new FormData();
  form.set("full_name", "New Reviewer");
  form.set("email", "reviewer@test.local");
  form.set("role_id", "a0000000-0000-0000-0000-000000000003");

  const result = await inviteUserAction({}, form);

  expect(result).toHaveProperty("message");
  expect(generateLink).toHaveBeenCalledOnce();
  expect(callerUpdate).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
});
