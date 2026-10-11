import { z } from "zod";

// z.guid(), not z.uuid(): seeded starter-role ids are not RFC 4122
// version-tagged, and zod 4's z.uuid() would reject them.
const optionalGuid = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.guid("That request was not valid.").optional(),
);

export const saveRoleSchema = z.object({
  role_id: optionalGuid,
  name: z
    .string()
    .trim()
    .min(2, "Role name needs at least 2 characters.")
    .max(50, "Role name is too long (50 characters max)."),
  description: z
    .string()
    .trim()
    .max(200, "Description is too long (200 characters max)."),
  permission_keys: z.array(z.string().min(1).max(100)).max(200),
});

export const deleteRoleSchema = z.object({
  role_id: z.guid("That request was not valid."),
});

/** Checkbox groups arrive as repeated `permission_keys` entries. */
export function roleFormInput(formData: FormData) {
  return {
    role_id: formData.get("role_id"),
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    permission_keys: formData.getAll("permission_keys"),
  };
}
