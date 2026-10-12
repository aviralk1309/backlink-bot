import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Link2 } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";

/** Link style for auth screens. Lighter indigo in dark theme for contrast. */
export const AUTH_LINK =
  "text-primary dark:text-accent-foreground focus-visible:ring-ring rounded font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-12">
      <div className="fixed top-3 right-3">
        <ThemeToggle />
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg"
        >
          <Link2 className="size-4" />
        </span>
        <span className="font-semibold tracking-tight">Backlink Bot</span>
      </div>
      <Card className="w-full max-w-sm shadow-sm [--card-spacing:--spacing(6)]">
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description ? (
              <p className="text-muted-foreground text-sm">{description}</p>
            ) : null}
          </div>
          {children}
          {footer ? (
            <div className="text-muted-foreground text-sm">{footer}</div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  description,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  description?: string;
}) {
  const descriptionId = description ? `${name}-description` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      {type === "password" ? (
        <PasswordInput
          id={name}
          name={name}
          autoComplete={autoComplete}
          aria-describedby={descriptionId}
          required
        />
      ) : (
        <Input
          id={name}
          name={name}
          type={type}
          autoComplete={autoComplete}
          aria-describedby={descriptionId}
          required
        />
      )}
      {description ? (
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </p>
      ) : null}
    </div>
  );
}
export function FormError({ message }: { message?: string }) {
  return message ? (
    <p
      role="alert"
      className="bg-destructive-soft text-destructive flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  ) : null;
}

export function FormSuccess({ message }: { message?: string }) {
  return message ? (
    <p
      role="status"
      className="bg-success-soft text-success flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
    >
      <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </p>
  ) : null;
}
