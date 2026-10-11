import { Suspense } from "react";
import { forbidden, redirect } from "next/navigation";
import { ADMIN_SECTIONS, visibleAdminSections } from "@/lib/admin-nav";
import { requirePagePermission } from "@/lib/auth/guard";

// The navbar's Admin link points here. Send the user to the first section
// they may open. Someone with no admin permission gets the forbidden page.
async function AdminIndex(): Promise<never> {
  const session = await requirePagePermission({
    anyOf: ADMIN_SECTIONS.map((s) => s.permission),
  });
  const first = visibleAdminSections(session.permissions)[0];
  if (!first) forbidden();
  redirect(first.href);
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <AdminIndex />
    </Suspense>
  );
}
