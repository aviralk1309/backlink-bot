import Link from "next/link";
import { Suspense } from "react";
import { AUTH_LINK, AuthShell } from "@/features/auth/auth-shell";
import { LoginForm } from "@/features/auth/forms";
import { getLoginNotice } from "@/lib/auth/messages";
import { safeNext } from "@/lib/auth/redirect";

type SearchParams = Promise<{ next?: string; error?: string }>;

// Cache Components: reading searchParams is request-time data, so it lives
// inside <Suspense>. The shell around it stays static and loads instantly.
async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <LoginForm next={safeNext(sp.next)} notice={getLoginNotice(sp.error)} />
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AuthShell
      title="Sign in"
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className={AUTH_LINK}>
            Request access
          </Link>
        </>
      }
    >
      <Suspense fallback={<LoginForm next="/" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
