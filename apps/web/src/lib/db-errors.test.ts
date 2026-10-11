import { describe, expect, it } from "vitest";
import { describeDbError } from "./db-errors";

describe("describeDbError", () => {
  it.each([
    ["lockout_last_admin", "at least one active Admin"],
    ["lockout_protected_role", "protected"],
    ["lockout_role_in_use", "still has users"],
    ["lockout_admin_permission", "must keep user and role management"],
    ["role_not_found", "no longer exists"],
    ["invalid_permission", "not recognized"],
    ["job_not_found", "That job no longer exists"],
    ["invalid_transition: start from running", "current status"],
    ["invalid_action", "not valid"],
    ["forbidden", "do not have permission"],
  ])("maps %s", (code, snippet) => {
    expect(describeDbError(code)).toContain(snippet);
  });

  it("finds the code inside a longer message", () => {
    expect(
      describeDbError("P0001: lockout_last_admin (CONTEXT: PL/pgSQL)"),
    ).toContain("at least one active Admin");
  });

  it("maps a job that is not ready, with its codes attached", () => {
    expect(
      describeDbError("job_not_ready:missing_country,no_source"),
    ).toContain("not ready to start");
  });

  it("maps a duplicate role name from the unique index", () => {
    const msg =
      'duplicate key value violates unique constraint "roles_name_lower_key"';
    expect(describeDbError(msg)).toBe("A role with that name already exists.");
  });

  it("maps a duplicate activity key and a duplicate blocklist domain", () => {
    expect(
      describeDbError(
        'duplicate key value violates unique constraint "activity_profiles_key_key"',
      ),
    ).toBe("An activity with that key already exists.");
    expect(
      describeDbError(
        'duplicate key value violates unique constraint "blocklist_domain_key"',
      ),
    ).toBe("That domain is already on the blocklist.");
  });

  it("falls back to a generic message", () => {
    expect(describeDbError("boom")).toBe(
      "Could not save the change. Try again.",
    );
  });
});
