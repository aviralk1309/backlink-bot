"use client";

import { Suspense, useState, type ReactNode } from "react";
import { PageSkeleton } from "@/components/app-skeletons";
import { SidebarNav, type NavItem } from "@/components/sidebar-nav";
import { Topbar } from "@/components/topbar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";

export function AppShell({
  items,
  userName,
  roleName,
  children,
}: {
  items: readonly NavItem[];
  userName: string;
  roleName: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      <a
        href="#main-content"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>

      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground sticky top-0 hidden h-svh shrink-0 border-r motion-safe:transition-[width] motion-safe:duration-200 md:block",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarNav
          items={items}
          userName={userName}
          roleName={roleName}
          collapsed={collapsed}
        />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="bg-sidebar text-sidebar-foreground w-72 max-w-[85vw] gap-0 p-0 data-[side=left]:w-72 sm:max-w-72"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Main navigation
          </SheetDescription>
          <SidebarNav
            items={items}
            userName={userName}
            roleName={roleName}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed(!collapsed)}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 outline-none md:px-8 md:py-8"
        >
          <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
