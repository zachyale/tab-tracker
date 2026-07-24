import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { authClient, useSession } from "../lib/auth";
import { Button, Card, ErrorNote, Input, Spinner } from "../components/fields";
import { NotificationPrefsCard } from "../components/NotificationPrefsCard";

export default function ProfilePage() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [nameNotice, setNameNotice] = useState("");
  const [nameError, setNameError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    if (!isPending && !session?.user) navigate("/login?next=%2Fprofile");
    if (session?.user) setName(session.user.name);
  }, [session, isPending, navigate]);

  if (isPending || !session?.user) return <Spinner />;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameError("");
    setNameNotice("");
    const { error } = await authClient.updateUser({ name: name.trim() });
    if (error) setNameError(error.message ?? "Failed to save");
    else setNameNotice("Saved ✓");
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (error) {
      setPasswordError(error.message ?? "Failed to change password");
    } else {
      setPasswordNotice("Password changed ✓ Other sessions were signed out.");
      setCurrentPassword("");
      setNewPassword("");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-2xl font-bold">Edit profile</h1>

      <Card>
        <form onSubmit={saveName} className="space-y-3">
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <div className="space-y-1">
            <Input label="Email" value={session.user.email} disabled />
            <p className="text-xs text-muted-foreground">
              Email can't be changed — it's how tabs find you.
            </p>
          </div>
          <ErrorNote>{nameError}</ErrorNote>
          <div className="flex items-center gap-3">
            <Button type="submit">Save</Button>
            {nameNotice && <span className="text-sm text-emerald-600 dark:text-emerald-400">{nameNotice}</span>}
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="mb-3 font-bold">Change password</h3>
        <form onSubmit={changePassword} className="space-y-3">
          <Input
            label="Current password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            label="New password"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
          <ErrorNote>{passwordError}</ErrorNote>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary">
              Change password
            </Button>
            {passwordNotice && <span className="text-sm text-emerald-600 dark:text-emerald-400">{passwordNotice}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Signed up with Google or SSO? You won't have a password to change here.
          </p>
        </form>
      </Card>

      <h2 className="pt-2 text-lg font-bold">Preferences</h2>
      <NotificationPrefsCard />
    </div>
  );
}
