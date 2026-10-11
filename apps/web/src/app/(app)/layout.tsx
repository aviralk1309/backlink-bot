import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { getSession } from "@/lib/auth/session";
import { visibleNavItems } from "@/lib/nav-access";

// Cache Components: the session comes from cookies (request-time data), so
// the navbar and the page content each stream inside their own <Suspense>.
async function AppNavbar() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <Navbar
      items={visibleNavItems(session.permissions)}
      userName={session.fullName || session.email}
      roleName={session.roleName}
    />
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="h-14 border-b" />}>
        <AppNavbar />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <Suspense
          fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
        >
          {children}
        </Suspense>
      </main>
    </>
  );
}
