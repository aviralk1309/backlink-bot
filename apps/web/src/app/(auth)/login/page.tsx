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

function LoginSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="bg-muted h-4 w-12 animate-pulse rounded" />
        <div className="bg-muted/60 h-10 w-full animate-pulse rounded-md" />
      </div>
      <div className="space-y-1.5">
        <div className="bg-muted h-4 w-16 animate-pulse rounded" />
        <div className="bg-muted/60 h-10 w-full animate-pulse rounded-md" />
      </div>
      <div className="bg-primary/40 h-10 w-full animate-pulse rounded-md" />
    </div>
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
      <Suspense fallback={<LoginSkeleton />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}
