# ADR 0013: Forbidden page shows with status 200
Status: Accepted
Context: Plan M1-S8 says a guarded URL without permission shows a 403 page.
Every page streams inside `<Suspense>` (needed for Cache Components), so the
response status is sent before the permission check runs. `forbidden()` then
renders the dedicated page but cannot change the status.
Decision: Use `forbidden()` and `app/(app)/forbidden.tsx`
(`experimental.authInterrupts`). Accept status 200 on the No access page.
Authorization stays in the database, so the status code protects nothing.
Alternatives:
- Check permissions in `proxy.ts` and return a real 403: one extra database
  query per admin request, and a second copy of the route-to-permission map.
- Render inline text per page (the earlier approach): the same status, and
  the message was copied into six pages.
Consequences: Scanners and monitors see 200 for forbidden admin URLs. The
page uses an experimental Next flag, which may change on upgrade.
Reversibility: Easy. Only the guard function and one page change.
Review trigger: Next stabilizes `authInterrupts` or changes streaming
behavior. A real need for a 403 status (monitoring, compliance). The M9
security review.