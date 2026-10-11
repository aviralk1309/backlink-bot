import { describe, expect, it } from "vitest";
import {
  firstIssue,
  loginSchema,
  setPasswordSchema,
  signupSchema,
} from "./schemas";

const validSignup = {
  full_name: "  Aviral K  ",
  email: "  Aviral@Example.COM ",
  password: "correct-horse-9",
  confirm_password: "correct-horse-9",
};

describe("auth schemas", () => {
  it("normalizes email and name on signup", () => {
    const r = signupSchema.parse(validSignup);
    expect(r.email).toBe("aviral@example.com");
    expect(r.full_name).toBe("Aviral K");
  });

  it("rejects mismatched passwords", () => {
    const r = signupSchema.safeParse({
      ...validSignup,
      confirm_password: "different-9-pass",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toBe("Passwords do not match.");
  });

  it.each([
    ["short1", "Use at least 10 characters."],
    ["onlyletterspassword", "Include at least one digit."],
    ["1234567890123", "Include at least one letter."],
    [`a1${"x".repeat(80)}`, "Use at most 72 characters."],
  ])("rejects weak password %j", (password, message) => {
    const r = setPasswordSchema.safeParse({
      password,
      confirm_password: password,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toBe(message);
  });

  it("login lowercases the email and requires a password", () => {
    expect(loginSchema.parse({ email: "A@B.co", password: "x" }).email).toBe(
      "a@b.co",
    );
    expect(
      loginSchema.safeParse({ email: "a@b.co", password: "" }).success,
    ).toBe(false);
  });
});
