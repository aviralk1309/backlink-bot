import type { ProfileStatus } from "../../lib/auth/gate";
export { describeDbError } from "../../lib/db-errors";

export const STATUS_FILTERS = [
  "all",
  "pending",
  "active",
  "rejected",
  "deactivated",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export function parseFilter(raw: string | undefined): StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as StatusFilter)
    : "all";
}

export type PlannedIntent =
  "approve" | "reject" | "change_role" | "deactivate" | "reactivate";

export type Target = {
  id: string;
  status: ProfileStatus;
  role_id: string | null;
};

export type Plan =
  | {
      ok: true;
      patch: Record<string, string>;
      notify?: "approved" | "rejected";
      success: string;
    }
  | { ok: false; error: string };

const fail = (error: string): Plan => ({ ok: false, error });

/**
 * Business rules for changing another user's account. Pure, so every rule is
 * unit-tested. The database still enforces the hard limits (RLS, last-Admin
 * guard); this layer gives clear messages and blocks foot-guns early.
 */
export function planUserAction(input: {
  intent: PlannedIntent;
  target: Target;
  actorId: string;
  roleId: string | null;
  now: string;
}): Plan {
  const { intent, target, actorId, roleId, now } = input;
  const isSelf = target.id === actorId;

  switch (intent) {
    case "approve":
      if (target.status !== "pending" && target.status !== "rejected") {
        return fail("Only pending or rejected requests can be approved.");
      }
      if (!roleId) return fail("Choose a role first.");
      return {
        ok: true,
        patch: {
          status: "active",
          role_id: roleId,
          approved_by: actorId,
          approved_at: now,
        },
        notify: "approved",
        success: "Approved. They have been emailed.",
      };

    case "reject":
      if (target.status !== "pending") {
        return fail("Only pending requests can be rejected.");
      }
      return {
        ok: true,
        patch: { status: "rejected" },
        notify: "rejected",
        success: "Rejected. They have been emailed.",
      };

    case "change_role":
      if (isSelf) return fail("You cannot change your own role.");
      if (target.status !== "active") {
        return fail("Only active users can change role.");
      }
      if (!roleId) return fail("Choose a role first.");
      if (roleId === target.role_id)
        return fail("They already have that role.");
      return {
        ok: true,
        patch: { role_id: roleId },
        success: "Role updated.",
      };

    case "deactivate":
      if (isSelf) return fail("You cannot deactivate yourself.");
      if (target.status !== "active") {
        return fail("Only active users can be deactivated.");
      }
      return {
        ok: true,
        patch: { status: "deactivated" },
        success: "Deactivated. They are signed out on their next request.",
      };

    case "reactivate":
      if (target.status !== "deactivated") {
        return fail("Only deactivated users can be reactivated.");
      }
      if (!target.role_id) {
        return fail("This user has no role. Approve them with a role instead.");
      }
      return {
        ok: true,
        patch: { status: "active" },
        success: "Reactivated.",
      };
  }
}
