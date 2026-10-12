import { Suspense, type ReactNode } from "react";
import { AdminSubnav } from "@/features/admin/admin-subnav";
import { visibleAdminSections } from "@/lib/admin-nav";
import { getSession } from "@/lib/auth/session";

// The session comes from cookies (request-time data), so the tab bar
// streams inside its own <Suspense>, like the navbar in (app)/layout.tsx.
async function AdminNav() {
  const session = await getSession();
  if (!session) return null;
  const items = visibleAdminSections(session.permissions).map((s) => ({
    label: s.label,
    href: s.href,
  }));
  // One section needs no tab bar.
  if (items.length < 2) return null;
  return <AdminSubnav items={items} />;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-11" />}>
        <AdminNav />
      </Suspense>
      {children}
    </>
  );
}
