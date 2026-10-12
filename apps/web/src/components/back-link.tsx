import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded text-sm outline-none focus-visible:ring-2"
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {children}
    </Link>
  );
}
