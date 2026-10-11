import "server-only";
import { forbidden, redirect } from "next/navigation";
import { isAllowed, type Requirement } from "./permissions";
import { getSession, type Session } from "./session";

/**
 * First line of every protected page. Signed-out users go to login. Signed-in
 * users without the permission get the forbidden page. Both calls never
 * return, so the session is always valid after this line.
 *
 * This is a courtesy, not security: the database refuses the same actions
 * through RLS even if a page forgets to call this.
 */
export async function requirePagePermission(
  requirement: Requirement,
): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAllowed(session.permissions, requirement)) forbidden();
  return session;
}
