import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useConfig } from "../App";
import { signUp } from "../lib/auth";
import { Button, Card, ErrorNote, Input } from "../components/fields";

export default function Signup() {
  const config = useConfig();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifySent, setVerifySent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await signUp.email({ name, email, password });
    if (error) {
      setBusy(false);
      setError(error.message ?? "Signup failed");
    } else if (config.smtp) {
      setBusy(false);
      setVerifySent(true);
    } else {
      window.location.href = next;
    }
  }

  if (verifySent) {
    return (
      <div className="mx-auto mt-8 max-w-sm">
        <Card>
          <h1 className="mb-2 text-xl font-bold">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <strong>{email}</strong>. Click it, then log in.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-4 text-center text-2xl font-bold">Create your login</h1>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <Input
            label="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder="How friends will see you"
          />
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Creating…" : "Sign up"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have a login?{" "}
        <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-semibold underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
