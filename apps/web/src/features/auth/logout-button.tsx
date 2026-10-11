import { Button } from "@/components/ui/button";

/** Plain form POST, so it works without client JavaScript. */
export function LogoutButton() {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
