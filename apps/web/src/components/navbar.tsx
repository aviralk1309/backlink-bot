import Link from "next/link";
import { NAV_ITEMS } from "@/lib/nav";

export function Navbar() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <span className="font-semibold">Backlink Bot</span>
        {NAV_ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            {i.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
