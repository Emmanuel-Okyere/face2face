"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthShell from "@/components/AuthShell";
import { api, Button, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
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
    <form onSubmit={submit} className="space-y-5">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="h-12 rounded-2xl px-4 text-base" />
      </label>
      <label className="block space-y-1.5">
        <span className="flex items-center justify-between text-sm font-medium">
          Password
          <Link href="/forgot-password" className="text-xs font-normal text-muted hover:text-ink">
            Forgot?
          </Link>
        </span>
        <span className="relative block">
          <Input
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-2xl px-4 pr-12 text-base"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {show ? (
                <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9.5 6a17 17 0 0 1-3 3.4M6.6 7.6C4.6 9 3.2 10.9 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              ) : (
                <>
                  <path d="M2.5 12c1-1.5 4.5-6 9.5-6s8.5 4.5 9.5 6c-1 1.5-4.5 6-9.5 6s-8.5-4.5-9.5-6Z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </span>
      </label>
      {err && <p className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{err}</p>}
      <Button type="submit" className="h-12 w-full rounded-2xl text-base" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-muted">Sign in to your dashboard.</p>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <Link href="/kiosk" className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-sm font-medium hover:bg-surface-2">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="3" width="16" height="13" rx="2" />
            <path d="M9 21h6M12 16v5" />
          </svg>
          Open kiosk
        </Link>
      </div>
    </AuthShell>
  );
}
