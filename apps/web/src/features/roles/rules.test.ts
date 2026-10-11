import { describe, expect, it } from "vitest";
import {
  filterGroups,
  groupPermissions,
  groupState,
  planRoleDelete,
  planRoleSave,
  setKeys,
  toggleKey,
} from "./rules";
import type { PermissionRow } from "./types";

const perms: PermissionRow[] = [
  {
    key: "users.manage",
    group: "Admin",
    description: "Invite and manage users",
  },
  { key: "jobs.view", group: "Jobs", description: "See jobs" },
  { key: "jobs.create", group: "Jobs", description: "Create jobs" },
  { key: "results.view", group: "Results", description: "See results" },
  { key: "roles.manage", group: "Admin", description: "Manage roles" },
  { key: "extra.thing", group: "Zeta", description: "Future group" },
];
const catalogKeys = perms.map((p) => p.key);

describe("groupPermissions", () => {
  const groups = groupPermissions(perms);
  it("orders known groups first, unknown last", () => {
    expect(groups.map((g) => g.name)).toEqual([
      "Jobs",
      "Results",
      "Admin",
      "Zeta",
    ]);
  });
  it("sorts keys inside a group", () => {
    expect(groups[0]?.permissions.map((p) => p.key)).toEqual([
      "jobs.create",
      "jobs.view",
    ]);
  });
});

describe("filterGroups", () => {
  const groups = groupPermissions(perms);
  it("returns everything for an empty query", () => {
    expect(filterGroups(groups, "  ")).toHaveLength(4);
  });
  it("matches key and description, case-insensitive", () => {
    const r = filterGroups(groups, "CREATE");
    expect(r).toHaveLength(1);
    expect(r[0]?.permissions.map((p) => p.key)).toEqual(["jobs.create"]);
  });
  it("keeps a group whole when its name matches", () => {
    const r = filterGroups(groups, "admin");
    expect(r[0]?.permissions).toHaveLength(2);
  });
  it("returns nothing when nothing matches", () => {
    expect(filterGroups(groups, "zzz")).toEqual([]);
  });
});

describe("selection helpers", () => {
  it("toggles without mutating the input", () => {
    const start = new Set(["a"]);
    const added = toggleKey(start, "b");
    expect([...added].sort()).toEqual(["a", "b"]);
    expect([...start]).toEqual(["a"]);
    expect([...toggleKey(added, "a")]).toEqual(["b"]);
  });
  it("sets and clears many keys", () => {
    const on = setKeys(new Set(["x"]), ["a", "b"], true);
    expect([...on].sort()).toEqual(["a", "b", "x"]);
    expect([...setKeys(on, ["a", "x"], false)]).toEqual(["b"]);
  });
  it("reports group state", () => {
    const sel = new Set(["a"]);
    expect(groupState(sel, ["a", "b"])).toBe("some");
    expect(groupState(sel, ["a"])).toBe("all");
    expect(groupState(sel, ["b"])).toBe("none");
    expect(groupState(sel, [])).toBe("none");
  });
});

describe("planRoleSave", () => {
  const custom = { id: "r-custom", is_protected: false };
  const admin = { id: "r-admin", is_protected: true };

  it("creates with sorted, de-duplicated keys", () => {
    const r = planRoleSave({
      role: null,
      actorRoleId: "r-admin",
      keys: ["jobs.view", "jobs.create", "jobs.view"],
      catalogKeys,
    });
    expect(r).toEqual({ ok: true, keys: ["jobs.create", "jobs.view"] });
  });
  it("allows a role with no permissions", () => {
    expect(
      planRoleSave({
        role: null,
        actorRoleId: "r-admin",
        keys: [],
        catalogKeys,
      }),
    ).toEqual({ ok: true, keys: [] });
  });
  it("rejects unknown keys", () => {
    const r = planRoleSave({
      role: null,
      actorRoleId: "r-admin",
      keys: ["nope.nope"],
      catalogKeys,
    });
    expect(r.ok).toBe(false);
  });
  it.each(["roles.manage", "users.manage"])(
    "protected role must keep %s",
    (missing) => {
      const keys = ["roles.manage", "users.manage", "jobs.view"].filter(
        (k) => k !== missing,
      );
      const r = planRoleSave({
        role: admin,
        actorRoleId: "someone-else",
        keys,
        catalogKeys,
      });
      expect(r).toEqual({
        ok: false,
        error: "The Admin role must keep user and role management.",
      });
    },
  );
  it("blocks removing roles.manage from your own role", () => {
    const r = planRoleSave({
      role: custom,
      actorRoleId: "r-custom",
      keys: ["jobs.view"],
      catalogKeys,
    });
    expect(r).toEqual({
      ok: false,
      error: "You cannot remove role management from your own role.",
    });
  });
  it("allows your own role when it keeps roles.manage", () => {
    const r = planRoleSave({
      role: custom,
      actorRoleId: "r-custom",
      keys: ["roles.manage"],
      catalogKeys,
    });
    expect(r.ok).toBe(true);
  });
  it("allows dropping roles.manage from someone else's role", () => {
    const r = planRoleSave({
      role: custom,
      actorRoleId: "r-admin",
      keys: ["jobs.view"],
      catalogKeys,
    });
    expect(r.ok).toBe(true);
  });
});

describe("planRoleDelete", () => {
  const role = { id: "r1", is_protected: false };
  it("blocks protected roles", () => {
    const r = planRoleDelete({
      role: { id: "r1", is_protected: true },
      userCount: 0,
      actorRoleId: "r2",
    });
    expect(r.ok).toBe(false);
  });
  it("blocks your own role", () => {
    expect(planRoleDelete({ role, userCount: 0, actorRoleId: "r1" })).toEqual({
      ok: false,
      error: "You cannot delete your own role.",
    });
  });
  it("blocks roles that still have users, singular and plural", () => {
    expect(planRoleDelete({ role, userCount: 1, actorRoleId: "r2" })).toEqual({
      ok: false,
      error: "1 user still has this role. Move them to another role first.",
    });
    expect(planRoleDelete({ role, userCount: 3, actorRoleId: "r2" })).toEqual({
      ok: false,
      error: "3 users still have this role. Move them to another role first.",
    });
  });
  it("allows an unused custom role", () => {
    expect(planRoleDelete({ role, userCount: 0, actorRoleId: "r2" })).toEqual({
      ok: true,
    });
  });
});
