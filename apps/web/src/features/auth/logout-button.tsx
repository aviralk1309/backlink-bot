import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Plain form POST, so it works without client JavaScript. */
export function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <form action="/auth/signout" method="post">
      {iconOnly ? (
        <Button type="submit" variant="ghost" size="icon">
          <LogOut aria-hidden />
          <span className="sr-only">Sign out</span>
        </Button>
      ) : (
        <Button type="submit" variant="ghost" size="sm">
          <LogOut aria-hidden data-icon="inline-start" />
          Sign out
        </Button>
      )}
    </form>
  );
}
