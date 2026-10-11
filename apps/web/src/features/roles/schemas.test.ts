import { describe, expect, it } from "vitest";
import { deleteRoleSchema, roleFormInput, saveRoleSchema } from "./schemas";

const ID = "a0000000-0000-0000-0000-000000000002";

describe("saveRoleSchema", () => {
  it("accepts a valid role and trims text", () => {
    const r = saveRoleSchema.safeParse({
      role_id: ID,
      name: "  Auditor ",
      description: "  Reads only ",
      permission_keys: ["jobs.view"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Auditor");
      expect(r.data.description).toBe("Reads only");
    }
  });

  it("treats empty or null role_id as create", () => {
    for (const role_id of ["", null]) {
      const r = saveRoleSchema.safeParse({
        role_id,
        name: "Auditor",
        description: "",
        permission_keys: [],
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.role_id).toBeUndefined();
    }
  });

  it("rejects short and long names", () => {
    const base = { description: "", permission_keys: [] };
    expect(saveRoleSchema.safeParse({ ...base, name: " a " }).success).toBe(
      false,
    );
    expect(
      saveRoleSchema.safeParse({ ...base, name: "x".repeat(51) }).success,
    ).toBe(false);
  });

  it("rejects a bad role id and a long description", () => {
    const base = { name: "Auditor", permission_keys: [] };
    expect(
      saveRoleSchema.safeParse({ ...base, role_id: "nope", description: "" })
        .success,
    ).toBe(false);
    expect(
      saveRoleSchema.safeParse({ ...base, description: "x".repeat(201) })
        .success,
    ).toBe(false);
  });

  it("rejects non-string permission entries", () => {
    const r = saveRoleSchema.safeParse({
      name: "Auditor",
      description: "",
      permission_keys: [new File(["x"], "x.txt")],
    });
    expect(r.success).toBe(false);
  });
});

describe("deleteRoleSchema", () => {
  it("needs a valid id", () => {
    expect(deleteRoleSchema.safeParse({ role_id: ID }).success).toBe(true);
    expect(deleteRoleSchema.safeParse({ role_id: "" }).success).toBe(false);
  });
});

describe("roleFormInput", () => {
  it("collects repeated permission_keys", () => {
    const fd = new FormData();
    fd.set("role_id", ID);
    fd.set("name", "Auditor");
    fd.append("permission_keys", "jobs.view");
    fd.append("permission_keys", "reports.view");
    const input = roleFormInput(fd);
    expect(input.permission_keys).toEqual(["jobs.view", "reports.view"]);
    expect(input.description).toBe("");
  });
});
