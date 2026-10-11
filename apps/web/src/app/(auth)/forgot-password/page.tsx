import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { ForgotPasswordForm } from "@/features/auth/forms";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your email and we will send you a link."
      footer={
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
