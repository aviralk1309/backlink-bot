import { describe, expect, it } from "vitest";
import { decideAccess, type AccessState } from "./gate";

const anon: AccessState = { kind: "anonymous" };
const active: AccessState = { kind: "profile", status: "active" };
const status = (s: "pending" | "rejected" | "deactivated"): AccessState => ({
  kind: "profile",
  status: s,
});

describe("decideAccess", () => {
  it("lets signed-out visitors reach guest pages", () => {
    for (const path of ["/login", "/signup", "/forgot-password"]) {
      expect(decideAccess(path, anon)).toEqual({ action: "allow" });
    }
  });

  it("sends signed-out visitors to /login and remembers where they were going", () => {
    expect(decideAccess("/", anon)).toEqual({
      action: "redirect",
      to: "/login",
    });
    expect(decideAccess("/jobs", anon, "?status=running")).toEqual({
      action: "redirect",
      to: "/login?next=%2Fjobs%3Fstatus%3Drunning",
    });
  });

  it("does not treat look-alike paths as public", () => {
    expect(decideAccess("/loginx", anon).action).toBe("redirect");
    expect(decideAccess("/authentic", anon).action).toBe("redirect");
  });

  it("keeps /set-password behind a session", () => {
    expect(decideAccess("/set-password", anon).action).toBe("redirect");
    expect(decideAccess("/set-password", active)).toEqual({ action: "allow" });
  });

  it("lets active users in and bounces them off guest pages", () => {
    expect(decideAccess("/jobs", active)).toEqual({ action: "allow" });
    expect(decideAccess("/login", active)).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it.each(["pending", "rejected", "deactivated"] as const)(
    "signs out %s users instead of letting them in",
    (s) => {
      const expected = {
        action: "redirect",
        to: `/auth/signout?reason=${s}`,
      };
      expect(decideAccess("/jobs", status(s))).toEqual(expected);
      expect(decideAccess("/login", status(s))).toEqual(expected);
    },
  );

  it("signs out a user that has no profile row", () => {
    expect(decideAccess("/", { kind: "no_profile" })).toEqual({
      action: "redirect",
      to: "/auth/signout?reason=no_profile",
    });
  });

  it("leaves confirm, sign-out and health reachable for everyone", () => {
    for (const state of [anon, active, status("pending")]) {
      for (const path of ["/auth/confirm", "/auth/signout", "/api/health"]) {
        expect(decideAccess(path, state)).toEqual({ action: "allow" });
      }
    }
  });
});
