"use client";

import Link from "next/link";
import { useState } from "react";
import { api, Button, Card, Field, Input, Logo } from "@/components/ui";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/forgot", { method: "POST", json: { email } });
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-bg flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-6 p-7">
        <Logo />
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        {sent ? (
          <p className="text-sm">
            If <span className="font-medium">{email}</span> has an account, a reset link is on its way.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button type="submit" className="w-full" loading={busy}>
              Send link
            </Button>
          </form>
        )}
        <Link href="/login" className="block text-center text-xs text-muted hover:text-ink">
          Back to sign in
        </Link>
      </Card>
    </div>
  );
}
