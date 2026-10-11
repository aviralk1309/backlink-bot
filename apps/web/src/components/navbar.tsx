import Link from "next/link";
import { LogoutButton } from "@/features/auth/logout-button";

type NavItem = { readonly label: string; readonly href: string };

export function Navbar({
  items,
  userName,
  roleName,
}: {
  items: readonly NavItem[];
  userName: string;
  roleName: string;
}) {
  return (
    <header className="border-b">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold">
          Backlink Bot
        </Link>
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            {i.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right text-xs leading-tight">
            <div className="font-medium">{userName}</div>
            <div className="text-muted-foreground">{roleName}</div>
          </div>
          <LogoutButton />
        </div>
      </nav>
    </header>
  );
}
