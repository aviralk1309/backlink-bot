import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";

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
    <main className="mx-auto flex min-h-[80vh] w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {children}
      {footer ? (
        <div className="text-muted-foreground text-sm">{footer}</div>
      ) : null}
    </main>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
      />
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  ) : null;
}
