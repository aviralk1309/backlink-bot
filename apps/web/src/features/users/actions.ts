"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AuthError, requirePermission } from "@/lib/auth/session";
import type { FormState } from "@/lib/auth/schemas";
import { appUrl, sendMail } from "@/lib/mail/send";
import {
  approvedEmail,
  inviteEmail,
  rejectedEmail,
  resetEmail,
} from "@/lib/mail/templates";
import { describeDbError, planUserAction, type Target } from "./rules";
import { inviteSchema, manageSchema } from "./schemas";

const FORBIDDEN: FormState = {
  error: "You do not have permission to do that.",
};
const EMAIL_FAILED = "Saved, but the email could not be sent.";

/** First line of every action here: the caller must hold users.manage. */
async function actor() {
  try {
    return await requirePermission("users.manage");
  } catch (err) {
    if (err instanceof AuthError) return null;
    throw err;
  }
}

type Profile = Target & { email: string; full_name: string };

export async function manageUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await actor();
  if (!session) return FORBIDDEN;

  const parsed = manageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That request was not valid." };
  const { intent, user_id, role_id } = parsed.data;

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, email, full_name, status, role_id")
    .eq("id", user_id)
    .maybeSingle();
  if (!target) return { error: "User not found." };
  const profile = target as Profile;

  if (intent === "send_link") return sendPasswordLink(profile);

  let roleName = "";
  if (role_id) {
    const { data: role } = await supabase
      .from("roles")
      .select("name")
      .eq("id", role_id)
      .maybeSingle();
    if (!role) return { error: "Role not found." };
    roleName = role.name as string;
  }

  const plan = planUserAction({
    intent,
    target: profile,
    actorId: session.userId,
    roleId: role_id ?? null,
    now: new Date().toISOString(),
  });
  if (!plan.ok) return { error: plan.error };

  // Runs under the caller's own session: RLS and the lockout triggers are
  // the real gate, not just the check above.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update(plan.patch)
    .eq("id", profile.id)
    .select("id");
  if (error) return { error: describeDbError(error.message) };
  if (!updated?.length) return FORBIDDEN;

  revalidatePath("/admin/users");

  if (plan.notify) {
    try {
      const email =
        plan.notify === "approved"
          ? approvedEmail({
              name: profile.full_name,
              roleName,
              loginUrl: appUrl("/login"),
            })
          : rejectedEmail({ name: profile.full_name });
      await sendMail(profile.email, email);
    } catch (err) {
      console.error("manageUserAction: email failed", err);
      return { message: `${plan.success.split(".")[0]}. ${EMAIL_FAILED}` };
    }
  }
  return { message: plan.success };
}

async function sendPasswordLink(profile: Profile): Promise<FormState> {
  if (profile.status !== "active") {
    return { error: "Only active users can be sent a password link." };
  }
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
    });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) {
      console.error("sendPasswordLink: generateLink failed", error?.message);
      return { error: "Could not create the link. Try again." };
    }
    const link = appUrl(
      `/auth/confirm?token_hash=${encodeURIComponent(hashed)}&type=recovery`,
    );
    await sendMail(profile.email, resetEmail({ link }));
  } catch (err) {
    console.error("sendPasswordLink failed", err);
    return { error: "Could not send the email. Check the mail settings." };
  }
  return { message: "Password link sent." };
}

export async function inviteUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await actor();
  if (!session) return FORBIDDEN;

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const { full_name, email, role_id } = parsed.data;

  const supabase = await createClient();
  const { data: role } = await supabase
    .from("roles")
    .select("name")
    .eq("id", role_id)
    .maybeSingle();
  if (!role) return { error: "Role not found." };

  // Service key: only reached after the users.manage check above.
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name } },
  });
  if (error || !data?.user || !data.properties?.hashed_token) {
    if (
      error?.code === "email_exists" ||
      error?.code === "user_already_exists"
    ) {
      return {
        error:
          "A user with this email already exists. Find them in the list below.",
      };
    }
    console.error("inviteUserAction: generateLink failed", error?.message);
    return { error: "Could not create the invite. Try again." };
  }

  // The new-user trigger made a pending profile; activate it with the role.
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      status: "active",
      role_id,
      approved_by: session.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", data.user.id);
  if (updateError) {
    // Do not leave a half-made account behind.
    await admin.auth.admin.deleteUser(data.user.id);
    console.error(
      "inviteUserAction: profile update failed",
      updateError.message,
    );
    return { error: "Could not create the invite. Try again." };
  }

  revalidatePath("/admin/users");

  try {
    const link = appUrl(
      `/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`,
    );
    await sendMail(
      email,
      inviteEmail({ name: full_name, roleName: role.name as string, link }),
    );
  } catch (err) {
    console.error("inviteUserAction: email failed", err);
    return {
      message:
        "User created, but the email could not be sent. Use “Send password link” on their row.",
    };
  }
  return { message: `Invite sent to ${email}.` };
}
