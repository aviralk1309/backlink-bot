"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/auth/schemas";
import {
  forgotPasswordAction,
  loginAction,
  setPasswordAction,
  signupAction,
} from "./actions";
import { Field, FormError } from "./auth-shell";

const initial: FormState = {};

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
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-sm">
        <Link href="/forgot-password" className="underline">
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
        <p role="status" className="text-sm">
          {state.message}
        </p>
        <Link href="/login" className="text-sm underline">
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
      />
      <Field
        label="Confirm password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
      />
      <p className="text-muted-foreground text-xs">
        At least 10 characters, with a letter and a digit.
      </p>
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending request…" : "Request access"}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initial,
  );

  if (state.message) {
    return (
      <p role="status" className="text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
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
      />
      <Field
        label="Confirm password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
      />
      <p className="text-muted-foreground text-xs">
        At least 10 characters, with a letter and a digit.
      </p>
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
