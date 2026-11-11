"use client";

import { useEffect, useState } from "react";
import { useMailEnabled, useMe } from "@/components/AdminShell";
import { api, Avatar, Button, Card, Field, Input, Pill, Spinner, timeAgo } from "@/components/ui";

type PA = { id: string; email: string; name: string; last_login_at: string | null; must_change_password: boolean; locked: boolean; orgs: number };

/**
 * People who can see and manage EVERY organization. Granting/revoking needs the
 * acting admin's password (step-up), because it's the most powerful permission.
 */
export default function PlatformAdmins() {
  const me = useMe();
  const mail = useMailEnabled();
  const [list, setList] = useState<PA[] | null>(null);
  const [f, setF] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<{ admins: PA[] }>("/api/platform/admins").then((r) => setList(r.admins));
  useEffect(() => {
    load();
  }, []);

  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ admin: { created: boolean }; invited: boolean; emailError?: string }>("/api/platform/admins", {
        method: "POST",
        json: { ...f, password: (!mail && f.password) || undefined },
      });
      setMsg(r.emailError ?? (r.invited ? `✓ Invite sent to ${f.email}` : r.admin.created ? "✓ Account created" : "✓ Existing account promoted"));
      setF({ name: "", email: "", password: "", confirmPassword: "" });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (a: PA) => {
    const pw = prompt(`Remove ${a.email}'s access to all organizations?\n\nThey keep access to organizations they're a member of. Enter YOUR password to confirm:`);
    if (!pw) return;
    try {
      await api(`/api/platform/admins?id=${a.id}`, { method: "DELETE", json: { confirmPassword: pw } });
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <Card>
      <h2 className="font-medium">Platform admins</h2>
      <p className="mb-4 text-xs text-muted">Access to every organization.</p>
      {!list ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line/70">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={a.name || a.email} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {a.name}
                  {a.id === me?.id && <Pill>You</Pill>}
                  {a.must_change_password && <Pill tone="warn">Temporary password</Pill>}
                  {a.locked && <Pill tone="danger">Locked</Pill>}
                </div>
                <div className="truncate text-xs text-muted">
                  {a.email} · {a.last_login_at ? `last in ${timeAgo(a.last_login_at)}` : "never signed in"}
                </div>
              </div>
              {a.id !== me?.id && (
                <Button variant="subtle" onClick={() => revoke(a)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={grant} className="mt-4 space-y-3 border-t border-line pt-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
        </div>
        {!mail && (
          <Field label="Temporary password" hint="Leave empty for an existing account">
            <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        )}
        <Field label="Your password">
          <Input required type="password" autoComplete="current-password" value={f.confirmPassword} onChange={(e) => setF({ ...f, confirmPassword: e.target.value })} />
        </Field>
        {msg && <p className="text-sm text-muted">{msg}</p>}
        <Button type="submit" className="w-full" loading={busy}>
          Add platform admin
        </Button>
      </form>
    </Card>
  );
}
