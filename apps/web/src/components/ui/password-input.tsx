"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Password input with a show/hide button. The button is a real tab stop. */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  const label = visible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Edge draws its own reveal icon. Hide it so there is only one.
        className={cn("pr-10 [&::-ms-reveal]:hidden", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        title={label}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md outline-none focus-visible:ring-2 pointer-coarse:size-10"
      >
        {visible ? (
          <EyeOff aria-hidden className="size-4" />
        ) : (
          <Eye aria-hidden className="size-4" />
        )}
      </button>
    </div>
  );
}

export { PasswordInput };
