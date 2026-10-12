import { History } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalTime } from "./local-time";
import type { JobEvent } from "./types";
import { actorLabel, describeEvent } from "./view";

/** The job's history, newest first. */
export function ActivityLog({ events }: { events: JobEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={<History />} title="No activity yet." />;
  }
  return (
    <ol
      aria-label="Job activity"
      className="bg-card divide-y rounded-xl border"
    >
      {events.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm"
        >
          <p className="flex min-w-0 gap-3">
            <span
              aria-hidden
              className="bg-primary/60 mt-1.5 size-1.5 shrink-0 rounded-full"
            />
            <span className="min-w-0">
              <span className="font-medium">{actorLabel(e)}</span>
              <span className="text-muted-foreground"> · </span>
              {describeEvent(e)}
            </span>
          </p>
          <LocalTime
            iso={e.created_at}
            className="text-muted-foreground text-xs whitespace-nowrap"
          />
        </li>
      ))}
    </ol>
  );
}
