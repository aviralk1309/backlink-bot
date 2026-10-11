import type { ReactNode } from "react";
import { isAllowed } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";

type Props = {
  fallback?: ReactNode;
  children: ReactNode;
} & (
  | { permission: string; anyOf?: never }
  | { anyOf: readonly string[]; permission?: never }
);

/**
 * Shows children only when the signed-in user holds the permission. Server
 * component on purpose: the permission list never ships to the browser, and
 * client components get plain boolean props instead. Reads cookies, so use it
 * inside <Suspense> (every page here already is).
 *
 * Hiding a button is a courtesy. The server action and the database still
 * refuse the request.
 */
export async function Can({
  permission,
  anyOf,
  fallback = null,
  children,
}: Props) {
  const session = await getSession();
  if (!session) return <>{fallback}</>;
  const requirement = permission ?? { anyOf: anyOf ?? [] };
  return isAllowed(session.permissions, requirement) ? (
    <>{children}</>
  ) : (
    <>{fallback}</>
  );
}
