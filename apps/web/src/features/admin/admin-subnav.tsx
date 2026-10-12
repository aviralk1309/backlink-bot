"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Item = { label: string; href: string };

export function AdminSubnav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin sections"
      className="-mx-1 mb-6 flex gap-1 overflow-x-auto px-1 py-1"
    >
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
