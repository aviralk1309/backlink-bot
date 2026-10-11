"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { label: string; href: string };

export function AdminSubnav({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin sections" className="mb-6 flex gap-2">
      {items.map((i) => {
        const active = pathname === i.href || pathname.startsWith(`${i.href}/`);
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
