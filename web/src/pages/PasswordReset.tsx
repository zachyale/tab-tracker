import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authClient } from "../lib/auth";
import { Button, Card, ErrorNote, Input } from "../components/ui";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    if (error) setError(error.message ?? "Failed to send reset email");
    else setSent(true);
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-4 text-center text-2xl font-bold">Reset password</h1>
      <Card>
        {sent ? (
          <p className="text-sm text-stone-600">
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" className="w-full">
              Send reset link
            </Button>
          </form>
        )}
      </Card>
      <p className="mt-4 text-center text-sm">
        <Link to="/login" className="underline">
          Back to login
        </Link>
      </p>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) setError(error.message ?? "Reset failed — the link may have expired");
    else navigate("/login");
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-4 text-center text-2xl font-bold">Choose a new password</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="New password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" className="w-full">
            Set password
          </Button>
        </form>
      </Card>
    </div>
  );
}
