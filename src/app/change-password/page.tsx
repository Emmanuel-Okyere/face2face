"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Button, Card, Field, Input, Logo } from "@/components/ui";

/** First sign-in with a temporary password (bootstrap or admin-assigned) lands here. */
export default function ChangePassword() {
  const router = useRouter();
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setErr("The new passwords don't match");
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/password", { method: "POST", json: { current: f.current, next: f.next } });
      router.replace("/admin");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid-bg flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-6 p-7">
        <Logo />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Set your own password</h1>
          <p className="mt-1 text-sm text-muted">Choose a new password to continue.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Temporary password">
            <Input type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 12 characters">
            <Input type="password" autoComplete="new-password" required minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" autoComplete="new-password" required minLength={12} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            Save and continue
          </Button>
        </form>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
          }}
          className="w-full text-center text-xs text-muted hover:text-ink"
        >
          Sign out instead
        </button>
      </Card>
    </div>
  );
}
