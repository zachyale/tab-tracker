import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useConfig } from "../App";
import { authClient, signIn } from "../lib/auth";
import { Button, Card, ErrorNote, Input } from "../components/fields";

export default function Login() {
  const config = useConfig();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const hasProviders = config.google || !!config.oidc;
  const [showPassword, setShowPassword] = useState(
    config.defaultAuthMethod === "password" || !hasProviders
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await signIn.email({ email, password });
    if (error) {
      setBusy(false);
      setError(error.message ?? "Login failed");
    } else {
      // Full navigation so the session cookie is picked up before any
      // logged-out redirect logic runs.
      window.location.href = next;
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-4 text-center text-2xl font-bold">Log in</h1>
      <Card className="space-y-4">
        {hasProviders && (
          <div className="space-y-2">
            {config.google && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void signIn.social({ provider: "google", callbackURL: next })}
              >
                Continue with Google
              </Button>
            )}
            {config.oidc && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() =>
                  void authClient.signIn.oauth2({ providerId: "oidc", callbackURL: next })
                }
              >
                Continue with {config.oidc.name}
              </Button>
            )}
          </div>
        )}

        {hasProviders && !showPassword ? (
          <button
            className="w-full text-center text-sm text-stone-500 underline"
            onClick={() => setShowPassword(true)}
          >
            Use email &amp; password instead
          </button>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {hasProviders && (
              <div className="flex items-center gap-3 text-xs text-stone-400">
                <div className="h-px flex-1 bg-stone-200" /> or <div className="h-px flex-1 bg-stone-200" />
              </div>
            )}
            <Input
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Logging in…" : "Log in"}
            </Button>
            {config.smtp && (
              <p className="text-center text-xs text-stone-500">
                <Link to="/forgot-password" className="underline">
                  Forgot your password?
                </Link>
              </p>
            )}
          </form>
        )}
      </Card>
      <p className="mt-4 text-center text-sm text-stone-600">
        No account yet?{" "}
        <Link to={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
