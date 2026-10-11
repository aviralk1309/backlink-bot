import { describe, expect, it } from "vitest";
import { describeDbError, parseFilter, planUserAction } from "./rules";
import { inviteSchema, manageSchema } from "./schemas";
import type { Target } from "./rules";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const ROLE_A = "a0000000-0000-0000-0000-000000000002";
const ROLE_B = "a0000000-0000-0000-0000-000000000003";
const NOW = "2026-10-09T00:00:00.000Z";

const target = (over: Partial<Target> = {}): Target => ({
  id: OTHER,
  status: "pending",
  role_id: null,
  ...over,
});

const plan = (
  intent: Parameters<typeof planUserAction>[0]["intent"],
  t: Target,
  roleId: string | null = null,
) => planUserAction({ intent, target: t, actorId: ADMIN, roleId, now: NOW });

describe("planUserAction", () => {
  it("approves a pending user with a role and records who approved", () => {
    expect(plan("approve", target(), ROLE_A)).toEqual({
      ok: true,
      patch: {
        status: "active",
        role_id: ROLE_A,
        approved_by: ADMIN,
        approved_at: NOW,
      },
      notify: "approved",
      success: "Approved. They have been emailed.",
    });
  });

  it("can re-approve a rejected user, but not an active one", () => {
    expect(plan("approve", target({ status: "rejected" }), ROLE_A).ok).toBe(
      true,
    );
    expect(plan("approve", target({ status: "active" }), ROLE_A).ok).toBe(
      false,
    );
  });

  it("needs a role to approve", () => {
    expect(plan("approve", target(), null)).toEqual({
      ok: false,
      error: "Choose a role first.",
    });
  });

  it("rejects only pending requests, and notifies them", () => {
    const r = plan("reject", target());
    expect(r.ok && r.notify).toBe("rejected");
    expect(plan("reject", target({ status: "active" })).ok).toBe(false);
  });

  it("changes the role of another active user", () => {
    const t = target({ status: "active", role_id: ROLE_A });
    const r = plan("change_role", t, ROLE_B);
    expect(r.ok && r.patch).toEqual({ role_id: ROLE_B });
    expect(plan("change_role", t, ROLE_A).ok).toBe(false);
    expect(plan("change_role", target(), ROLE_B).ok).toBe(false);
  });

  it("blocks self role-change and self-deactivation", () => {
    const self = target({ id: ADMIN, status: "active", role_id: ROLE_A });
    expect(plan("change_role", self, ROLE_B)).toEqual({
      ok: false,
      error: "You cannot change your own role.",
    });
    expect(plan("deactivate", self)).toEqual({
      ok: false,
      error: "You cannot deactivate yourself.",
    });
  });

  it("deactivates active users and reactivates deactivated ones", () => {
    const active = target({ status: "active", role_id: ROLE_A });
    const r = plan("deactivate", active);
    expect(r.ok && r.patch).toEqual({ status: "deactivated" });

    const off = target({ status: "deactivated", role_id: ROLE_A });
    const back = plan("reactivate", off);
    expect(back.ok && back.patch).toEqual({ status: "active" });
    expect(plan("reactivate", active).ok).toBe(false);
  });

  it("will not reactivate a user who has no role", () => {
    expect(plan("reactivate", target({ status: "deactivated" })).ok).toBe(
      false,
    );
  });
});

describe("describeDbError", () => {
  it.each([
    ["lockout_last_admin", "There must always be at least one active Admin."],
    [
      "new row violates: lockout_role_in_use",
      "That role still has users. Move them to another role first.",
    ],
    ["something else", "Could not save the change. Try again."],
  ])("maps %j", (message, expected) => {
    expect(describeDbError(message)).toBe(expected);
  });
});

describe("parseFilter", () => {
  it("accepts known statuses and falls back to all", () => {
    expect(parseFilter("pending")).toBe("pending");
    expect(parseFilter("constructor")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });
});

describe("schemas", () => {
  it("accepts the seeded starter-role ids (not RFC 4122 tagged)", () => {
    const r = manageSchema.safeParse({
      intent: "approve",
      user_id: OTHER,
      role_id: ROLE_A,
    });
    expect(r.success).toBe(true);
  });

  it("treats an empty role as missing and rejects unknown intents", () => {
    const ok = manageSchema.parse({
      intent: "deactivate",
      user_id: OTHER,
      role_id: "",
    });
    expect(ok.role_id).toBeUndefined();
    expect(
      manageSchema.safeParse({ intent: "delete_everything", user_id: OTHER })
        .success,
    ).toBe(false);
  });

  it("normalizes invite input", () => {
    const r = inviteSchema.parse({
      full_name: "  Asha R  ",
      email: " Asha@Example.COM ",
      role_id: ROLE_B,
    });
    expect(r.email).toBe("asha@example.com");
    expect(r.full_name).toBe("Asha R");
    expect(
      inviteSchema.safeParse({ full_name: "A", email: "x", role_id: "" })
        .success,
    ).toBe(false);
  });
});
