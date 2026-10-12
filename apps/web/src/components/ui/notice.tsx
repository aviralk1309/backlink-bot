import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  success: {
    className: "bg-success-soft text-success",
    Icon: CheckCircle2,
    role: "status",
  },
  info: {
    className: "bg-info-soft text-info",
    Icon: Info,
    role: "status",
  },
  error: {
    className: "bg-destructive-soft text-destructive",
    Icon: AlertCircle,
    role: "alert",
  },
} as const;

/**
 * Inline message. Errors announce at once (alert), the rest politely
 * (status). Pass role="status" for an error that is just page content.
 */
function Notice({
  tone,
  role,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  role?: "status" | "alert";
  children: ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon, role: toneRole } = TONES[tone];
  return (
    <p
      role={role ?? toneRole}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        toneClass,
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export { Notice };
