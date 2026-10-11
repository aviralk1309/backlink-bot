import Link from "next/link";
import { AuthShell } from "@/features/auth/auth-shell";
import { SignupForm } from "@/features/auth/forms";

export default function SignupPage() {
  return (
    <AuthShell
      title="Request access"
      description="An admin reviews every request. You will get an email once you are approved."
      footer={
        <>
          Already approved?{" "}
          <Link href="/login" className="underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
