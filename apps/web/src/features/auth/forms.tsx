"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";
import {
  forgotPasswordAction,
  loginAction,
  setPasswordAction,
  signupAction,
} from "./actions";
import { AUTH_LINK, Field, FormError, FormSuccess } from "./auth-shell";

const initial: FormState = {};

function SubmitButton({
  pending,
  idle,
  busy,
}: {
  pending: boolean;
  idle: string;
  busy: string;
}) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? (
        <Loader2
          aria-hidden
          data-icon="inline-start"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : null}
      {pending ? busy : idle}
    </Button>
  );
}

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initial);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
      />
      <FormError message={state.error ?? notice} />
      <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
      <p className="text-sm">
        <Link href="/forgot-password" className={AUTH_LINK}>
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signupAction, initial);

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormSuccess message={state.message} />
        <Link href="/login" className={`${AUTH_LINK} text-sm`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Full name" name="full_name" autoComplete="name" />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        description="At least 10 characters, with a letter and a digit."
      />
      <Field
        label="Confirm password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
      />
      <FormError message={state.error} />
      <SubmitButton
        pending={pending}
        idle="Request access"
        busy="Sending request…"
      />
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initial,
  );

  if (state.message) {
    return <FormSuccess message={state.message} />;
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <FormError message={state.error} />
      <SubmitButton pending={pending} idle="Send reset link" busy="Sending…" />
    </form>
  );
}

export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    setPasswordAction,
    initial,
  );
  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        description="At least 10 characters, with a letter and a digit."
      />
      <Field
        label="Confirm password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
      />
      <FormError message={state.error} />
      <SubmitButton pending={pending} idle="Save password" busy="Saving…" />
    </form>
  );
}
