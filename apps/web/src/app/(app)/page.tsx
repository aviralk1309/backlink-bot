import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default function HomePage() {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
    >
      <Welcome />
    </Suspense>
  );
}

async function Welcome() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome, {session.fullName || session.email}
      </h1>
      <p className="text-muted-foreground text-sm">
        You are signed in as {session.roleName}.
      </p>
    </section>
  );
}
