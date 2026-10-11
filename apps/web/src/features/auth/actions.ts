"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNext } from "@/lib/auth/redirect";
import { getLoginNotice } from "@/lib/auth/messages";
import {
  firstIssue,
  forgotPasswordSchema,
  loginSchema,
  setPasswordSchema,
  signupSchema,
  type FormState,
} from "@/lib/auth/schemas";
import { appUrl, sendMail } from "@/lib/mail/send";
import { resetEmail } from "@/lib/mail/templates";

const raw = (formData: FormData) => Object.fromEntries(formData);

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse(raw(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { error: "Invalid email or password." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile?.status !== "active") {
    await supabase.auth.signOut();
    const key = profile?.status ?? "no_profile";
    return { error: getLoginNotice(key) ?? "Your account is not active." };
  }

  redirect(safeNext(formData.get("next")?.toString()));
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signupSchema.safeParse(raw(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name } },
  });

  // With confirmations off, signUp opens a session. Nobody gets in before an
  // admin approves, so drop it straight away.
  await supabase.auth.signOut();

  if (error?.code === "weak_password") {
    return { error: "Choose a stronger password." };
  }
  if (error?.code === "over_request_rate_limit") {
    return { error: "Too many attempts. Try again in a few minutes." };
  }
  // An existing email gets the same answer as a new one, so the form cannot
  // be used to find out who has an account. Any other failure is real and
  // must not look like success.
  if (
    error &&
    error.code !== "user_already_exists" &&
    error.code !== "email_exists"
  ) {
    console.error("signupAction failed", error.code, error.message);
    return { error: "Could not submit your request. Try again later." };
  }
  return {
    message:
      "Request received. An admin will review it, and you will get an email once you are approved.",
  };
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(raw(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const generic: FormState = {
    message:
      "If an active account exists for that email, a reset link is on its way.",
  };

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("status")
      .eq("email", parsed.data.email)
      .maybeSingle();
    if (profile?.status !== "active") return generic;

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: parsed.data.email,
    });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) return generic;

    const link = appUrl(
      `/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery`,
    );
    await sendMail(parsed.data.email, resetEmail({ link }));
  } catch (err) {
    console.error("forgotPasswordAction failed", err);
  }
  return generic;
}

export async function setPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = setPasswordSchema.safeParse(raw(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=link_invalid");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Choose a password you have not used before." };
    }
    if (error.code === "weak_password") {
      return { error: "Choose a stronger password." };
    }
    return { error: "Could not update your password. Try again." };
  }
  redirect("/");
}
