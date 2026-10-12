"use client";

import { useSyncExternalStore } from "react";

// Reads the real theme from the <html> class, so the manual toggle wins
// over the OS setting. Reused by the theme toggle in R3.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function useResolvedTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () =>
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    () => "light",
  );
}
