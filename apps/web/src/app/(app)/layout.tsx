import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ShellSkeleton } from "@/components/app-skeletons";
import { getSession } from "@/lib/auth/session";
import { visibleNavItems } from "@/lib/nav-access";

// Cache Components: the session comes from cookies (request-time data), so
// the shell and the page inside it stream under one <Suspense>.
async function ShellWithSession({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <AppShell
      items={visibleNavItems(session.permissions)}
      userName={session.fullName || session.email}
      roleName={session.roleName}
    >
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ShellWithSession>{children}</ShellWithSession>
    </Suspense>
  );
}
