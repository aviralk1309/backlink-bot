import { AuthShell } from "@/features/auth/auth-shell";
import { SetPasswordForm } from "@/features/auth/forms";

// Reached from invite and reset emails via /auth/confirm, which signs the
// user in. The middleware keeps everyone else out.
export default function SetPasswordPage() {
  return (
    <AuthShell
      title="Choose a password"
      description="You will use it to sign in from now on."
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
