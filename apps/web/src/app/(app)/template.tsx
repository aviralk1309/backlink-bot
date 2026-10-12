import type { ReactNode } from "react";

// A template remounts on every navigation, so each page fades in.
export default function Template({ children }: { children: ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
      {children}
    </div>
  );
}
