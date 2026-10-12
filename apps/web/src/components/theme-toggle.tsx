"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

/** Until the first click the theme follows the OS. After it, the choice sticks. */
export function ThemeToggle() {
  const theme = useResolvedTheme();
  const next = theme === "dark" ? "light" : "dark";

  function toggle() {
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage blocked: the theme still changes for this visit.
    }
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}
