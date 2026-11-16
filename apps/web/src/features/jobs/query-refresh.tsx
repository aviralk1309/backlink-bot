"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { POLL_INTERVAL_MS } from "./stats";

export function QueryRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
