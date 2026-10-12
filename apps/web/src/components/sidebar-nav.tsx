"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  FileText,
  LayoutDashboard,
  Link2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "@/features/auth/logout-button";
import { cn } from "@/lib/utils";

export type NavItem = { readonly label: string; readonly href: string };

// Icons live here, not in lib/nav.ts, so the nav data stays UI-free.
const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/jobs": Briefcase,
  "/reports": FileText,
  "/admin": ShieldCheck,
};

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SidebarNav({
  items,
  userName,
  roleName,
  collapsed = false,
  onNavigate,
}: {
  items: readonly NavItem[];
  userName: string;
  roleName: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const all: readonly NavItem[] = [{ label: "Dashboard", href: "/" }, ...items];

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <Link
          href="/"
          onClick={onNavigate}
          className="focus-visible:ring-ring flex items-center gap-2 rounded-lg outline-none focus-visible:ring-2"
        >
          <span
            aria-hidden
            className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg"
          >
            <Link2 className="size-4" />
          </span>
          <span
            className={cn(
              "font-semibold tracking-tight",
              collapsed && "sr-only",
            )}
          >
            Backlink Bot
          </span>
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
        {all.map((item) => {
          const Icon = ICONS[item.href];
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "focus-visible:ring-sidebar-ring flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset pointer-coarse:h-11",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              {Icon ? <Icon aria-hidden className="size-4 shrink-0" /> : null}
              <span className={cn(collapsed && "sr-only")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className={cn("flex items-center gap-3", collapsed && "flex-col")}>
          <span
            aria-hidden
            className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
          >
            {initials(userName)}
          </span>
          <div
            className={cn(
              "min-w-0 flex-1 leading-tight",
              collapsed && "sr-only",
            )}
          >
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-muted-foreground truncate text-xs">{roleName}</p>
          </div>
          <LogoutButton iconOnly={collapsed} />
        </div>
      </div>
    </div>
  );
}
