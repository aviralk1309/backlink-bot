import Link from "next/link";
import { cn } from "@/lib/utils";
import { JOB_TABS, JOB_TAB_LABELS, type JobTab } from "./view";

/** Overview, Settings and Activity. Plain links, so each tab is a URL. */
export function JobTabs({ jobId, active }: { jobId: string; active: JobTab }) {
  return (
    <nav
      aria-label="Job sections"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1"
    >
      {JOB_TABS.map((tab) => (
        <Link
          key={tab}
          href={
            tab === "overview" ? `/jobs/${jobId}` : `/jobs/${jobId}?tab=${tab}`
          }
          aria-current={tab === active ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 pointer-coarse:h-11",
            tab === active
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {JOB_TAB_LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
