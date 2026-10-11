import { describe, expect, it } from "vitest";
import {
  approvedEmail,
  escapeHtml,
  inviteEmail,
  rejectedEmail,
  resetEmail,
} from "./templates";

describe("email templates", () => {
  it("escapes user-supplied values in the HTML body", () => {
    const e = inviteEmail({
      name: '<script>alert("x")</script>',
      roleName: "Admin & co",
      link: "https://app.test/auth/confirm?token_hash=a&type=invite",
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Admin &amp; co");
    expect(e.html).toContain("token_hash=a&amp;type=invite");
  });

  it("puts the raw link in the plain-text body", () => {
    const link = "https://app.test/auth/confirm?token_hash=a&type=recovery";
    expect(resetEmail({ link }).text).toContain(link);
  });

  it("falls back to a neutral greeting when no name is set", () => {
    expect(rejectedEmail({ name: "" }).text).toContain("Hi there,");
    expect(
      approvedEmail({
        name: "",
        roleName: "Viewer",
        loginUrl: "https://app.test/login",
      }).text,
    ).toContain("Hi there,");
  });

  it("escapeHtml covers the five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
