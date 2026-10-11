import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLE_ID,
  parseBootstrapInput,
  planBootstrap,
} from "./bootstrap-lib.mjs";

const URL_LOCAL = "http://127.0.0.1:54321";
const base = {
  NEXT_PUBLIC_SUPABASE_URL: URL_LOCAL,
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  BOOTSTRAP_ADMIN_EMAIL: "Boss@Example.com",
};
const confirm = ["--confirm-url", URL_LOCAL];
const parse = (env = {}, args = confirm) =>
  parseBootstrapInput({ env: { ...base, ...env }, args });

describe("parseBootstrapInput", () => {
  it("normalizes input and applies defaults", () => {
    expect(parse()).toEqual({
      ok: true,
      value: {
        email: "boss@example.com",
        name: "Admin",
        password: null,
        supabaseUrl: URL_LOCAL,
        appUrl: "http://localhost:3000",
      },
    });
    const slashed = parse(
      { NEXT_PUBLIC_SUPABASE_URL: `${URL_LOCAL}/` },
      ["--confirm-url", URL_LOCAL],
    );
    expect(slashed.ok).toBe(true);
  });

  it("needs the Supabase URL", () => {
    const r = parse({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(r).toEqual({
      ok: false,
      error: "NEXT_PUBLIC_SUPABASE_URL is not set.",
    });
  });

  it("needs the service key", () => {
    const r = parse({ SUPABASE_SERVICE_ROLE_KEY: "  " });
    expect(r.ok).toBe(false);
  });

  it("needs --confirm-url and says which URL to use", () => {
    const r = parse({}, []);
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`--confirm-url ${URL_LOCAL}`);
  });

  it("refuses a --confirm-url that does not match", () => {
    const r = parse({}, ["--confirm-url", "https://prod.supabase.co"]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("does not match");
  });

  it("does not take another flag as the --confirm-url value", () => {
    const r = parse({}, ["--confirm-url", "--other"]);
    expect(r.ok).toBe(false);
  });

  it("needs an email", () => {
    expect(parse({ BOOTSTRAP_ADMIN_EMAIL: "" }).ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(parse({ BOOTSTRAP_ADMIN_EMAIL: "not-an-email" }).ok).toBe(false);
  });

  it("rejects a one-character name", () => {
    expect(parse({ BOOTSTRAP_ADMIN_NAME: "A" }).ok).toBe(false);
  });

  it.each([
    ["too short", "abc123"],
    ["no digit", "abcdefghijkl"],
    ["no letter", "1234567890123"],
    ["too long", `a1${"x".repeat(71)}`],
  ])("rejects a weak password: %s", (_label, password) => {
    expect(parse({ BOOTSTRAP_ADMIN_PASSWORD: password }).ok).toBe(false);
  });

  it("accepts a valid password", () => {
    const r = parse({ BOOTSTRAP_ADMIN_PASSWORD: "Correct-horse-1" });
    expect(r.ok).toBe(true);
    expect(r.value.password).toBe("Correct-horse-1");
  });
});

describe("planBootstrap", () => {
  it("creates when there is no such user", () => {
    expect(planBootstrap(null)).toEqual({ action: "create" });
  });

  it("does nothing for an active Admin", () => {
    expect(
      planBootstrap({ status: "active", role_id: ADMIN_ROLE_ID }),
    ).toEqual({ action: "noop" });
  });

  it("promotes an active user with another role", () => {
    expect(planBootstrap({ status: "active", role_id: "other" })).toEqual({
      action: "promote",
      from: { status: "active", role_id: "other" },
    });
  });

  it.each(["pending", "rejected", "deactivated"])(
    "promotes a %s user",
    (status) => {
      expect(planBootstrap({ status, role_id: null }).action).toBe("promote");
    },
  );
});

