"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { breadcrumbsFor } from "@/lib/breadcrumbs";
import { cn } from "@/lib/utils";

export function Topbar({
  collapsed,
  onToggleCollapsed,
  onOpenMobileNav,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobileNav: () => void;
}) {
  const crumbs = breadcrumbsFor(usePathname());

  return (
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 supports-[backdrop-filter]:backdrop-blur-sm md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden />
        ) : (
          <PanelLeftClose aria-hidden />
        )}
      </Button>

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li
                key={crumb.href}
                className={cn(
                  "flex min-w-0 items-center gap-1.5",
                  !last && "hidden sm:flex",
                )}
              >
                {index > 0 ? (
                  <ChevronRight
                    aria-hidden
                    className="text-muted-foreground hidden size-3.5 shrink-0 sm:block"
                  />
                ) : null}
                {last ? (
                  <span aria-current="page" className="truncate font-medium">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded outline-none focus-visible:ring-2"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <ThemeToggle />
    </header>
  );
}
