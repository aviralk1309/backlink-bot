"use client";

import { useSyncExternalStore } from "react";

const KEY = "sidebar-collapsed";
const EVENT = "sidebar-collapsed-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function read() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Collapsed state kept in localStorage. Server render is always expanded. */
export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);
  function setCollapsed(value: boolean) {
    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Storage blocked: the change still applies for this visit only.
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return [collapsed, setCollapsed];
}
