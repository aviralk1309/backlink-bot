import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

/** bcrypt (used by Supabase Auth) ignores everything past 72 bytes. */
export const newPassword = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use at most 72 characters.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/\d/, "Include at least one digit.");

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(72),
});

export const signupSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(100, "Name is too long."),
    email,
    password: newPassword,
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  });

export const forgotPasswordSchema = z.object({ email });

export const setPasswordSchema = z
  .object({ password: newPassword, confirm_password: z.string() })
  .refine((d) => d.password === d.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match.",
  });

export type FormState = { error?: string; message?: string };

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}
