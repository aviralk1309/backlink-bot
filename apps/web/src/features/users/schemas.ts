import { z } from "zod";

// z.guid(), not z.uuid(): the seeded starter-role ids are not RFC 4122
// version-tagged, and zod 4's z.uuid() would reject them.
const optionalGuid = z.preprocess(
  (v) => (v === "" || v === null ? undefined : v),
  z.guid().optional(),
);

export const manageSchema = z.object({
  intent: z.enum([
    "approve",
    "reject",
    "change_role",
    "deactivate",
    "reactivate",
    "send_link",
  ]),
  user_id: z.guid(),
  role_id: optionalGuid,
});

export const inviteSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Enter their full name.")
    .max(100, "Name is too long."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.")),
  role_id: z.guid("Choose a role."),
});
