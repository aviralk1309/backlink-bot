import type { PermissionGroup, PermissionRow } from "./types";

/** The database also enforces this (guard_role_permissions). */
export const LOCKED_ADMIN_KEYS = ["roles.manage", "users.manage"] as const;
export type LockedMap = Record<string, string>;

const GROUP_ORDER = ["Jobs", "Results", "Data", "Admin"];

/**
 * Groups the catalog for the matrix. Known groups come first in a fixed
 * order, unknown ones (added by future migrations) follow alphabetically.
 */
export function groupPermissions(
  perms: readonly PermissionRow[],
): PermissionGroup[] {
  const byGroup = new Map<string, PermissionRow[]>();
  for (const p of perms) {
    const list = byGroup.get(p.group) ?? [];
    list.push(p);
    byGroup.set(p.group, list);
  }
  const rank = (name: string) => {
    const i = GROUP_ORDER.indexOf(name);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...byGroup.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([name, permissions]) => ({
      name,
      permissions: [...permissions].sort((a, b) => a.key.localeCompare(b.key)),
    }));
}

/** Search by key, description or group name. A group-name hit keeps the group whole. */
export function filterGroups(
  groups: readonly PermissionGroup[],
  query: string,
): PermissionGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  return groups
    .map((g) =>
      g.name.toLowerCase().includes(q)
        ? g
        : {
            ...g,
            permissions: g.permissions.filter(
              (p) =>
                p.key.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q),
            ),
          },
    )
    .filter((g) => g.permissions.length > 0);
}

export function toggleKey(
  selected: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Select or clear a set of keys (a whole group, or just the visible ones). */
export function setKeys(
  selected: ReadonlySet<string>,
  keys: readonly string[],
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const k of keys) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

export type GroupState = "none" | "some" | "all";

export function groupState(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): GroupState {
  if (keys.length === 0) return "none";
  const count = keys.filter((k) => selected.has(k)).length;
  if (count === 0) return "none";
  return count === keys.length ? "all" : "some";
}

export type RoleSavePlan =
  { ok: true; keys: string[] } | { ok: false; error: string };

/**
 * Business rules for saving a role. Pure, so every rule is unit-tested.
 * The database still enforces the hard limits; this layer gives clear
 * messages and blocks self-lockout, which the database does not.
 */
export function planRoleSave(input: {
  /** null when creating. */
  role: { id: string; is_protected: boolean } | null;
  actorRoleId: string;
  keys: readonly string[];
  catalogKeys: readonly string[];
}): RoleSavePlan {
  const { role, actorRoleId, keys, catalogKeys } = input;
  const known = new Set(catalogKeys);
  const unique = [...new Set(keys)].sort();

  if (unique.some((k) => !known.has(k))) {
    return {
      ok: false,
      error: "One of the permissions is not recognized. Reload and try again.",
    };
  }

  if (
    role?.is_protected &&
    LOCKED_ADMIN_KEYS.some((k) => !unique.includes(k))
  ) {
    return {
      ok: false,
      error: "The Admin role must keep user and role management.",
    };
  }

  if (role && role.id === actorRoleId && !unique.includes("roles.manage")) {
    return {
      ok: false,
      error: "You cannot remove role management from your own role.",
    };
  }

  return { ok: true, keys: unique };
}

export type RoleDeletePlan = { ok: true } | { ok: false; error: string };

export function planRoleDelete(input: {
  role: { id: string; is_protected: boolean };
  userCount: number;
  actorRoleId: string;
}): RoleDeletePlan {
  const { role, userCount, actorRoleId } = input;
  if (role.is_protected) {
    return {
      ok: false,
      error: "The Admin role is protected and cannot be deleted.",
    };
  }
  if (role.id === actorRoleId) {
    return { ok: false, error: "You cannot delete your own role." };
  }
  if (userCount > 0) {
    const who =
      userCount === 1 ? "1 user still has" : `${userCount} users still have`;
    return {
      ok: false,
      error: `${who} this role. Move them to another role first.`,
    };
  }
  return { ok: true };
}
/**
 * Permissions the form must keep switched on, with the reason shown next to
 * each. Mirrors planRoleSave, so the user is stopped before submitting.
 */
export function lockedPermissions(input: {
  isProtected: boolean;
  isOwnRole: boolean;
}): LockedMap {
  const locked: LockedMap = {};
  if (input.isOwnRole) {
    locked["roles.manage"] = "Your own role must keep this.";
  }
  if (input.isProtected) {
    for (const k of LOCKED_ADMIN_KEYS) {
      locked[k] = "Required for the Admin role.";
    }
  }
  return locked;
}

/** Adds every locked key back, so no click can clear one. */
export function enforceLocked(
  selected: ReadonlySet<string>,
  locked: LockedMap,
): Set<string> {
  const next = new Set(selected);
  for (const k of Object.keys(locked)) next.add(k);
  return next;
}

const COPY_SUFFIX = " (copy)";
// Keep in sync with the name limit in schemas.ts.
const NAME_MAX = 50;

/** Default name for a cloned role, always within the name limit. */
export function cloneName(name: string): string {
  const base = name
    .trim()
    .slice(0, NAME_MAX - COPY_SUFFIX.length)
    .trimEnd();
  return `${base}${COPY_SUFFIX}`;
}
