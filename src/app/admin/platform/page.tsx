"use client";

import { useEffect, useState } from "react";
import { PageHeader, useMailEnabled, useMe } from "@/components/AdminShell";
import PlatformAdmins from "@/components/PlatformAdmins";
import { api, Button, Card, Empty, Field, hardNavigate, Input, OrgLogo, Pill, Spinner, timeAgo } from "@/components/ui";
import { toastNextPage } from "@/components/feedback";

type O = {
  id: string;
  name: string;
  logo_url: string | null;
  slug: string;
  time_zone: string;
  self_checkin: boolean;
  created_at: string;
  people: number;
  enrolled: number;
  admins: number;
  last_checkin: string | null;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

/** Platform admins: every tenant on this deployment, and onboarding new ones. */
export default function Platform() {
  const me = useMe();
  const mail = useMailEnabled();
  const [orgs, setOrgs] = useState<O[] | null>(null);
  const [f, setF] = useState({
    name: "",
    slug: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ orgs: O[] }>("/api/platform/orgs")
      .then((r) => setOrgs(r.orgs))
      .catch((e) => setErr(e.message));
  }, []);

  if (me && !me.isPlatform) return <Empty title="Platform admins only" />;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ emailError?: string }>("/api/platform/orgs", {
        method: "POST",
        json: {
          name: f.name,
          slug: f.slug,
          timeZone: f.timeZone,
          owner: f.ownerEmail
            ? { email: f.ownerEmail, name: f.ownerName || f.ownerEmail.split("@")[0], password: (!mail && f.ownerPassword) || undefined }
            : undefined,
        },
      });
      if (r.emailError) toastNextPage(r.emailError, "danger");
      else toastNextPage(`${f.name} created`);
      hardNavigate("/admin/settings"); // the new org is now selected
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const switchTo = async (id: string) => {
    await api("/api/admin/switch-org", { method: "POST", json: { orgId: id } });
    hardNavigate("/admin");
  };

  return (
    <>
      <PageHeader title="Platform" />
      <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
        <div>
          {!orgs ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : orgs.length === 0 ? (
            <Empty title="No organizations yet">Create the first one →</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {orgs.map((o) => (
                <Card key={o.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <OrgLogo src={o.logo_url} name={o.name} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{o.name}</div>
                        <div className="text-xs text-muted">
                          /{o.slug} · {o.time_zone}
                        </div>
                      </div>
                    </div>
                    {o.self_checkin && <Pill tone="good">Links on</Pill>}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    {[
                      ["People", o.people],
                      ["Enrolled", o.enrolled],
                      ["Admins", o.admins],
                    ].map(([l, v]) => (
                      <div key={l} className="rounded-xl bg-surface-2/70 py-2">
                        <div className="text-lg tabular-nums">{v}</div>
                        <div className="text-[10px] text-muted">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted">
                    <span>{o.last_checkin ? `last check-in ${timeAgo(o.last_checkin)}` : "no check-ins yet"}</span>
                    <Button variant="ghost" className="px-3 py-1 text-xs" onClick={() => switchTo(o.id)}>
                      Open →
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-4 font-medium">New organization</h2>
            <form onSubmit={create} className="space-y-3">
              <Field label="Name">
                <Input
                  required
                  value={f.name}
                  placeholder="Grace Chapel Accra"
                  onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })}
                />
              </Field>
              <Field label="Web address" hint={`/checkin/${f.slug || "your-org"}`}>
                <Input
                  required
                  value={f.slug}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  minLength={3}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setF({ ...f, slug: slugify(e.target.value) });
                  }}
                />
              </Field>
              <Field label="Time zone">
                <Input value={f.timeZone} onChange={(e) => setF({ ...f, timeZone: e.target.value })} />
              </Field>
              <div className="border-t border-line pt-3 text-xs text-muted">
                First owner (optional)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Owner name">
                  <Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
                </Field>
                <Field label="Owner email">
                  <Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
                </Field>
              </div>
              {!mail && (
                <Field label="Temporary password" hint="At least 12 characters">
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={f.ownerPassword}
                    onChange={(e) => setF({ ...f, ownerPassword: e.target.value })}
                  />
                </Field>
              )}
              {err && <p className="text-sm text-danger">{err}</p>}
              <Button type="submit" className="w-full" loading={busy}>
                Create organization
              </Button>
            </form>
          </Card>
          <PlatformAdmins />
        </div>
      </div>
    </>
  );
}
