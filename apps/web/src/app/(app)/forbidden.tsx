import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * Rendered by forbidden() inside the (app) layout, so the navbar stays.
 * Needs experimental.authInterrupts in next.config.ts.
 */
export default function ForbiddenPage() {
  return (
    <section role="alert" className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">No access</h1>
      <p className="text-muted-foreground text-sm">
        You do not have permission to open this page. Ask an Admin if you need
        it.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to home
      </Link>
    </section>
  );
}
