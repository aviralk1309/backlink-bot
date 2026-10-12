"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      closeButton
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
export { toast } from "sonner";
