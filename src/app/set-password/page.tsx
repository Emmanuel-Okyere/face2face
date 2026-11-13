"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, Button, Field, Input, Spinner } from "@/components/ui";
import AuthShell from "@/components/AuthShell";

type Info = { email: string; name: string; purpose: "invite" | "reset" };

/** Landing page for emailed invite and reset links (/set-password#t=…). */
export default function SetPassword() {
  const token = useRef<string | null | undefined>(undefined);
  const [info, setInfo] = useState<Info | null>(null);
  const [bad, setBad] = useState(false);
  const [f, setF] = useState({ next: "", confirm: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Read once (effects can run twice), then drop the token from the address bar and history.
    if (token.current === undefined) {
      token.current = new URLSearchParams(location.hash.slice(1)).get("t");
      history.replaceState(null, "", location.pathname);
    }
    const t = token.current;
    // A second link clicked while this page is open only changes the hash: start over.
    const onHash = () => location.reload();
    addEventListener("hashchange", onHash);
    (t ? api<Info>("/api/auth/set-password", { method: "POST", json: { token: t } }) : Promise.reject())
      .then(setInfo)
      .catch(() => setBad(true));
    return () => removeEventListener("hashchange", onHash);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.next !== f.confirm) return setErr("The passwords don't match");
    setBusy(true);
    setErr("");
    try {
      await api("/api/auth/set-password", { method: "POST", json: { token: token.current, password: f.next } });
      location.replace("/admin");
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="space-y-6">
        {bad ? (
          <>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Link expired</h1>
              <p className="mt-1 text-sm text-muted">This link has expired or was already used.</p>
            </div>
            <Link href="/forgot-password" className="block rounded-full bg-ink px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-ink/85">
              Get a new link
            </Link>
          </>
        ) : !info ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{info.purpose === "invite" ? `Welcome, ${info.name.split(" ")[0] || "there"}` : "Choose a new password"}</h1>
              <p className="mt-1 text-sm text-muted">{info.email}</p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {/* Lets password managers save the right username. */}
              <input type="email" autoComplete="username" value={info.email} readOnly hidden />
              <Field label="New password" hint="At least 12 characters">
                <Input type="password" autoComplete="new-password" required minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
              </Field>
              <Field label="Confirm password">
                <Input type="password" autoComplete="new-password" required minLength={12} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
              </Field>
              {err && <p className="text-sm text-danger">{err}</p>}
              <Button type="submit" className="w-full" loading={busy}>
                {info.purpose === "invite" ? "Set password and sign in" : "Save and sign in"}
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
}
