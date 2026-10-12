"use client";

import { useSyncExternalStore } from "react";
import { format } from "date-fns";

const subscribe = () => () => {};

/**
 * A timestamp in the viewer's own time zone. The server cannot know it, so
 * the first render (and the server HTML) shows UTC, and the browser swaps in
 * local time right after hydration without a mismatch warning.
 */
export function LocalTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const text = useSyncExternalStore(
    subscribe,
    () => format(new Date(iso), "d MMM yyyy, HH:mm"),
    () => `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
