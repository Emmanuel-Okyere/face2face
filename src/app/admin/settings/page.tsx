"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader, useMailEnabled, useMe } from "@/components/AdminShell";
import FieldsEditor from "@/components/FieldsEditor";
import GroupsEditor from "@/components/GroupsEditor";
import LogoUploader from "@/components/LogoUploader";
import { api, Avatar, Button, Card, cx, Field, Input, Pill, Spinner, timeAgo } from "@/components/ui";
import { ask, toast, toastError } from "@/components/feedback";

type OrgView = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin";
  timeZone: string;
  geo: { lat: number | null; lng: number | null; radiusM: number; required: boolean };
  selfCheckin: boolean;
  checkinLink: string;
  logoUrl: string | null;
};
type A = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin";
  created_at: string;
  last_login_at: string | null;
  must_change_password: boolean;
  locked: boolean;
  sessions: number;
};
type S = { id: string; created_at: string; last_used_at: string; ip: string | null; user_agent: string | null; current: boolean };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const b = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return `${b}${os ? ` on ${os}` : ""}`;
}

const ZONES: string[] = (() => {
  try {
    // The browser list omits plain "UTC" (the default for new orgs) — keep it selectable.
    const list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    return ["UTC", "Africa/Accra", "Africa/Lagos", "Europe/London", "America/New_York"];
  }
})();

export default function Settings() {
  const me = useMe();
  const [org, setOrg] = useState<OrgView | null>(null);
  useEffect(() => {
    api<{ org: OrgView }>("/api/admin/org").then((r) => setOrg(r.org));
  }, []);
  const isOwner = org?.role === "owner" || !!me?.isPlatform;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          {org ? (
            <OrgCard org={org} canEdit={isOwner} onChange={setOrg} />
          ) : (
            <Card>
              <Spinner />
            </Card>
          )}
          <GroupsEditor canEdit={isOwner} />
          <Team canEdit={isOwner} />
        </div>
        <Security />
      </div>
      <div className="mt-4">
        <FieldsEditor canEdit={isOwner} />
      </div>
    </>
  );
}

function OrgCard({ org, canEdit, onChange }: { org: OrgView; canEdit: boolean; onChange: (o: OrgView) => void }) {
  const [f, setF] = useState({ name: org.name, timeZone: org.timeZone });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState(false);

  const patch = async (json: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    setMsg("");
    try {
      const r = await api<{ org: OrgView }>("/api/admin/org", { method: "PATCH", json });
      onChange(r.org);
      if (tag === "save") toast("Saved");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const rotate = async () => {
    if (!(await ask({ title: "Create a new shared link?", body: "The current link stops working immediately.", confirm: "Create new link", danger: true }))) return;
    setBusy("rotate");
    const r = await api<{ org: OrgView }>("/api/admin/org?action=rotate-key", { method: "POST" });
    onChange(r.org);
    setBusy("");
  };

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium">Organization</h2>
        <Pill>/{org.slug}</Pill>
      </div>
      <div className="mb-5">
        <LogoUploader name={org.name} logoUrl={org.logoUrl} canEdit={canEdit} onChange={(logoUrl) => onChange({ ...org, logoUrl })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input value={f.name} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Time zone">
          <select
            value={f.timeZone}
            disabled={!canEdit}
            onChange={(e) => setF({ ...f, timeZone: e.target.value })}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
          >
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <div className="flex items-end justify-end gap-3 sm:col-span-2">
          {msg && <span className="text-sm text-muted">{msg}</span>}
          {canEdit && (
            <Button
              loading={busy === "save"}
              onClick={() => patch({ name: f.name, timeZone: f.timeZone }, "save")}
            >
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Phone check-in links</h3>
          </div>
          <button
            role="switch"
            aria-checked={org.selfCheckin}
            disabled={!canEdit || busy === "toggle"}
            onClick={() => patch({ selfCheckin: !org.selfCheckin }, "toggle")}
            className={cx("relative h-6 w-11 shrink-0 rounded-full transition", org.selfCheckin ? "bg-good" : "bg-line")}
          >
            <span
              className={cx(
                "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
                org.selfCheckin ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </div>
        {org.selfCheckin && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={org.checkinLink} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(org.checkinLink);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {canEdit && (
              <button onClick={rotate} className="text-xs text-muted underline hover:text-ink">
                {busy === "rotate" ? "Making a new link…" : "Make a new link"}
              </button>
            )}
            <LocationCheck org={org} canEdit={canEdit} onSave={(geo) => patch({ geo }, "geo")} saving={busy === "geo"} />
          </div>
        )}
      </div>
    </Card>
  );
}

const RADII = [100, 200, 300, 500, 1000];

/** Phone check-in only near the organization (browser location). */
function LocationCheck({
  org,
  canEdit,
  onSave,
  saving,
}: {
  org: OrgView;
  canEdit: boolean;
  onSave: (geo: OrgView["geo"]) => void;
  saving: boolean;
}) {
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState("");
  const g = org.geo;
  const hasPoint = g.lat !== null && g.lng !== null;

  const useHere = () => {
    if (!navigator.geolocation) return setErr("This browser can't share its location.");
    setLocating(true);
    setErr("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        onSave({ ...g, lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 });
      },
      () => {
        setLocating(false);
        setErr("Couldn't get your location. Allow location access and try again.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="mt-4 space-y-2.5 rounded-2xl border border-line p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">Only near {org.name}</div>
        <button
          role="switch"
          aria-checked={g.required}
          aria-label="Require location"
          disabled={!canEdit || saving || (!hasPoint && !g.required)}
          onClick={() => onSave({ ...g, required: !g.required })}
          className={cx("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-40", g.required ? "bg-good" : "bg-line")}
        >
          <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", g.required ? "left-[22px]" : "left-0.5")} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {hasPoint ? (
          <a
            href={`https://www.google.com/maps?q=${g.lat},${g.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-xs text-ink/70 underline"
          >
            {g.lat!.toFixed(5)}, {g.lng!.toFixed(5)}
          </a>
        ) : (
          <span className="text-xs text-muted">No location set</span>
        )}
        {canEdit && (
          <Button variant="ghost" className="px-3 py-1 text-xs" loading={locating} onClick={useHere}>
            Use my current location
          </Button>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          Within
          <select
            value={g.radiusM}
            disabled={!canEdit || saving}
            onChange={(e) => onSave({ ...g, radiusM: Number(e.target.value) })}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r >= 1000 ? `${r / 1000} km` : `${r} m`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

function Team({ canEdit }: { canEdit: boolean }) {
  const me = useMe();
  const mail = useMailEnabled();
  const [admins, setAdmins] = useState<A[] | null>(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "admin" as "admin" | "owner" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<{ admins: A[] }>("/api/admin/admins").then((r) => setAdmins(r.admins));
  useEffect(() => {
    load();
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ admin: { created: boolean }; invited: boolean; emailError?: string }>("/api/admin/admins", {
        method: "POST",
        json: { ...f, password: (!mail && f.password) || undefined },
      });
      setMsg(
        r.emailError ??
          (r.invited ? `✓ Invite sent to ${f.email}` : r.admin.created ? "✓ Added" : "✓ Existing account added"),
      );
      setF({ name: "", email: "", password: "", role: "admin" });
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = async (a: A, method: "DELETE" | "PATCH", json?: { action: string; role?: string }) => {
    if (method === "DELETE" && !(await ask({ title: `Remove ${a.name || a.email}?`, body: `${a.email} loses access to this organization.`, confirm: "Remove", danger: true }))) return;
    try {
      await api(`/api/admin/admins?id=${a.id}`, { method, json });
      if (json?.action === "invite") toast(`Invite sent to ${a.email}`);
      else if (method === "DELETE") toast(`${a.name || a.email} removed`);
      load();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Card>
      <h2 className="mb-4 font-medium">Team</h2>
      {!admins ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-line/70">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={a.name || a.email} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {a.name}
                  {a.id === me?.id && <Pill>You</Pill>}
                  <Pill>{a.role === "owner" ? "Owner" : "Admin"}</Pill>
                  {a.must_change_password && <Pill tone="warn">Temporary password</Pill>}
                  {!a.last_login_at && !a.must_change_password && <Pill tone="warn">Invited</Pill>}
                  {a.locked && <Pill tone="danger">Locked</Pill>}
                </div>
                <div className="truncate text-xs text-muted">
                  {a.email} · {a.last_login_at ? `last in ${timeAgo(a.last_login_at)}` : "never signed in"}
                </div>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  {a.locked && (
                    <Button variant="ghost" onClick={() => act(a, "PATCH", { action: "unlock" })}>
                      Unlock
                    </Button>
                  )}
                  {mail && !a.last_login_at && a.id !== me?.id && (
                    <Button variant="ghost" onClick={() => act(a, "PATCH", { action: "invite" })}>
                      Resend invite
                    </Button>
                  )}
                  {a.id !== me?.id && (
                    <>
                      <Button
                        variant="subtle"
                        onClick={() => act(a, "PATCH", { action: "role", role: a.role === "owner" ? "admin" : "owner" })}
                      >
                        Make {a.role === "owner" ? "admin" : "owner"}
                      </Button>
                      <Button variant="subtle" onClick={() => act(a, "DELETE")}>
                        Remove
                      </Button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={add} className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2">
          <Field label="Name">
            <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          {!mail && (
            <Field label="Temporary password" hint="At least 12 characters">
              <Input
                type="password"
                autoComplete="new-password"
                value={f.password}
                onChange={(e) => setF({ ...f, password: e.target.value })}
              />
            </Field>
          )}
          <Field label="Role">
            <select
              value={f.role}
              onChange={(e) => setF({ ...f, role: e.target.value as "admin" | "owner" })}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
          <div className="flex items-center justify-end gap-3 sm:col-span-2">
            {msg && <span className="text-sm text-muted">{msg}</span>}
            <Button type="submit" loading={busy}>
              Add to team
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function Security() {
  const router = useRouter();
  const [sessions, setSessions] = useState<S[] | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<{ sessions: S[] }>("/api/auth/sessions").then((r) => setSessions(r.sessions));
  useEffect(() => {
    load();
  }, []);

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", json: pw });
      setPw({ current: "", next: "" });
      toast("Password changed — every other device was signed out");
      setMsg("");
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (s: S) => {
    await api(`/api/auth/sessions?id=${s.id}`, { method: "DELETE" });
    if (s.current) router.replace("/login");
    else load();
  };

  return (
    <div className="space-y-4" id="security">
      <Card>
        <h2 className="mb-4 font-medium">Your password</h2>
        <form onSubmit={changePw} className="space-y-3">
          <Field label="Current password">
            <Input
              required
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
          </Field>
          <Field label="New password" hint="At least 12 characters">
            <Input
              required
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
          </Field>
          <div className="flex items-center justify-end gap-3">
            {msg && <span className="text-sm text-muted">{msg}</span>}
            <Button type="submit" loading={busy}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">Your signed-in devices</h2>
          <Button
            variant="danger"
            onClick={async () => {
              await fetch("/api/auth/logout?all=1", { method: "POST" });
              router.replace("/login");
            }}
          >
            Sign out everywhere
          </Button>
        </div>
        {!sessions ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-line/70 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {device(s.user_agent)} {s.current && <Pill tone="good">This device</Pill>}
                  </div>
                  <div className="text-xs text-muted">
                    {s.ip} · active {timeAgo(s.last_used_at)} · since {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Button variant="subtle" onClick={() => revoke(s)}>
                  {s.current ? "Sign out" : "Revoke"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
