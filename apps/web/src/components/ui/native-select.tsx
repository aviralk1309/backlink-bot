import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Styled native <select>. Keeps platform picker, keyboard and a11y behavior. */
function NativeSelect({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <div className={cn("relative w-full", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          "border-input bg-card text-foreground focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:border-destructive dark:bg-input/30 h-9 w-full appearance-none rounded-lg border py-1 pr-8 pl-2.5 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11",
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export { NativeSelect };
