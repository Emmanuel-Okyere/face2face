"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api, Button, Card, Field, Input, Logo } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ mustChangePassword?: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
      router.replace(r.mustChangePassword ? "/change-password" : safeNext);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Email">
        <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {err && <p className="text-sm text-danger">{err}</p>}
      <Button type="submit" className="w-full" loading={busy}>
        Sign in
      </Button>
      <Link href="/forgot-password" className="block text-center text-xs text-muted hover:text-ink">
        Forgot password?
      </Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid-bg flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-6 p-7">
        <Logo />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Admin sign in</h1>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </Card>
    </div>
  );
}
