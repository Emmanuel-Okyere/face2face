"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { api, Button, Card, cx, Empty, Field, Input, Pill, Spinner, timeAgo } from "@/components/ui";

type K = {
  id: string;
  name: string;
  location: string | null;
  allow_qr: boolean;
  voice_default: boolean;
  paused: boolean;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  checkins: number;
};

export default function Kiosks() {
  const [ks, setKs] = useState<K[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const load = () => api<{ kiosks: K[] }>("/api/admin/kiosks").then((r) => setKs(r.kiosks));
  useEffect(() => {
    load();
  }, []);

  const patch = async (k: K, json: Record<string, unknown>) => {
    await api(`/api/admin/kiosks?id=${k.id}`, { method: "PATCH", json });
    await load();
  };
  const revoke = async (k: K) => {
    if (
      !confirm(
        `Revoke “${k.name}” permanently? The device is unpaired and must be paired again to be used.\n\nTo stop it for a while instead, use Pause.`,
      )
    )
      return;
    await api(`/api/admin/kiosks?id=${k.id}`, { method: "DELETE" });
    load();
  };

  return (
    <>
      <PageHeader
        title="Kiosks"
        actions={
          <Link href="/kiosk">
            <Button>Pair this device</Button>
          </Link>
        }
      />
      {!ks ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : ks.length === 0 ? (
        <Empty title="No kiosks yet">Open /kiosk on a tablet or laptop at the entrance, sign in, and pair it.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ks.map((k) =>
            editing === k.id ? (
              <EditKiosk
                key={k.id}
                k={k}
                onCancel={() => setEditing(null)}
                onSave={async (json) => {
                  await patch(k, json);
                  setEditing(null);
                }}
              />
            ) : (
              <Card key={k.id} className={cx(k.revoked_at && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{k.name}</div>
                    {k.location && <div className="truncate text-sm text-ink/70">{k.location}</div>}
                    <div className="text-xs text-muted">
                      Paired {new Date(k.created_at).toLocaleDateString()}
                      {k.created_by ? ` by ${k.created_by}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {k.revoked_at ? (
                      <Pill tone="danger">Revoked</Pill>
                    ) : (
                      <>
                        {k.paused && <Pill tone="warn">Paused</Pill>}
                        {!k.allow_qr && <Pill>QR off</Pill>}
                        {k.voice_default && <Pill>Voice on</Pill>}
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <div>
                    <div className="text-3xl tabular-nums">{k.checkins}</div>
                    <div className="text-xs text-muted">check-ins · seen {k.last_seen_at ? timeAgo(k.last_seen_at) : "never"}</div>
                  </div>
                  {!k.revoked_at && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button variant="ghost" onClick={() => setEditing(k.id)}>
                        Edit
                      </Button>
                      <Button variant="ghost" onClick={() => patch(k, { paused: !k.paused })}>
                        {k.paused ? "Resume" : "Pause"}
                      </Button>
                    </div>
                  )}
                </div>
                {!k.revoked_at && (
                  <div className="mt-3 border-t border-line pt-3 text-right">
                    <button onClick={() => revoke(k)} className="text-xs text-muted hover:text-danger">
                      Revoke permanently
                    </button>
                  </div>
                )}
              </Card>
            ),
          )}
        </div>
      )}
    </>
  );
}

function EditKiosk({ k, onSave, onCancel }: { k: K; onSave: (json: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState({
    name: k.name,
    location: k.location ?? "",
    allowQr: k.allow_qr,
    voiceDefault: k.voice_default,
    paused: k.paused,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await onSave({ ...f, location: f.location.trim() || null });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card className="ring-2 ring-ink/10">
      <form onSubmit={save} className="space-y-3">
        <Field label="Name">
          <Input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Location (optional)">
          <Input maxLength={120} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />
        </Field>
        <div className="space-y-2.5 pt-1">
          <Toggle label="Allow QR badge check-in" checked={f.allowQr} onChange={(v) => setF({ ...f, allowQr: v })} />
          <Toggle label="Voice greeting" checked={f.voiceDefault} onChange={(v) => setF({ ...f, voiceDefault: v })} />
          <Toggle label="Paused" checked={f.paused} onChange={(v) => setF({ ...f, paused: v })} />
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm">{label}</div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-good" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
