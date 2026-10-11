/**
 * What a page or component needs: one permission, or any one of several.
 * Pure, so every rule is unit-tested. This only drives the UI. The database
 * enforces the real rules through RLS.
 */
export type Requirement = string | { readonly anyOf: readonly string[] };

export function isAllowed(
  permissions: readonly string[],
  requirement: Requirement,
): boolean {
  if (typeof requirement === "string") {
    return permissions.includes(requirement);
  }
  // An empty anyOf allows nobody (fail closed).
  return requirement.anyOf.some((key) => permissions.includes(key));
}
