import { expect, it, vi } from "vitest";

const { generateLink, update } = vi.hoisted(() => ({
  generateLink: vi.fn().mockResolvedValue({
    data: { user: { id: "new-user" }, properties: { hashed_token: "token" } },
    error: null,
  }),
  update: vi.fn(),
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
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: "Admin" } }) }),
      }),
    }),
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

it.fails("S-01 users.manage-only actor cannot invite an Admin", async () => {
  const form = new FormData();
  form.set("full_name", "New Admin");
  form.set("email", "new-admin@test.local");
  form.set("role_id", "a0000000-0000-0000-0000-000000000001");

  const result = await inviteUserAction({}, form);

  expect(result).toHaveProperty("error");
  expect(generateLink).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
