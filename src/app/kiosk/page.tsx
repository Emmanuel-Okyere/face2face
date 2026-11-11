"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Button, Card, Field, Input, Logo, OrgLogo, Spinner } from "@/components/ui";
import { prefetchFaceModels } from "@/lib/face/models";

const Kiosk = dynamic(() => import("@/components/Kiosk"), { ssr: false });

type Session = {
  kiosk: {
    id: string;
    name: string;
    location: string | null;
    allowQr: boolean;
    voiceDefault: boolean;
    paused: boolean;
    org: string;
    logoUrl: string | null;
    open: { name: string; until: string }[];
    next: string | null;
  } | null; admin: { name: string; org: string | null } | null };

export default function KioskPage() {
  const [s, setS] = useState<Session | null>(null);
  const [name, setName] = useState("Front desk");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Fetch the face models while pairing / waiting for a service.
  useEffect(() => prefetchFaceModels(), []);

  const load = async () => {
    try {
      let r = await api<Session>("/api/kiosk/session");
      // Access token may simply have expired — try a silent refresh before asking to sign in.
      if (!r.kiosk && !r.admin && (await fetch("/api/auth/refresh", { method: "POST" })).ok) {
        r = await api<Session>("/api/kiosk/session");
      }
      setS(r);
    } catch {
      setS({ kiosk: null, admin: null });
    }
  };
  useEffect(() => {
    const t = setTimeout(load, 0);
    // Pick up admin changes (rename, pause, QR, voice) and revocation without touching the device.
    const poll = setInterval(async () => {
      try {
        const r = await api<Session>("/api/kiosk/session");
        setS(r); // revoked → falls back to the pairing screen
      } catch {}
    }, 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, []);

  if (!s)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  if (s.kiosk?.paused)
    return (
      <div className="grid-bg flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <OrgLogo src={s.kiosk.logoUrl} name={s.kiosk.org} size={72} />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Check-in is paused</h1>
          <p className="mt-2 text-muted">
            {s.kiosk.org} · {s.kiosk.name}
            {s.kiosk.location ? ` · ${s.kiosk.location}` : ""}
          </p>
        </div>
      </div>
    );
  if (s.kiosk && s.kiosk.open.length === 0)
    return (
      <div className="grid-bg flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <OrgLogo src={s.kiosk.logoUrl} name={s.kiosk.org} size={72} />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">No service right now</h1>
          {s.kiosk.next && <p className="mt-2 text-lg text-muted">Next: {s.kiosk.next}</p>}
        </div>
      </div>
    );
  if (s.kiosk)
    return (
      <Kiosk
        service={s.kiosk.open.map((o) => `${o.name} · until ${o.until}`).join("  ·  ")}
        kioskName={s.kiosk.location ? `${s.kiosk.name} · ${s.kiosk.location}` : s.kiosk.name}
        orgName={s.kiosk.org}
        logoUrl={s.kiosk.logoUrl}
        allowQr={s.kiosk.allowQr}
        voice={s.kiosk.voiceDefault}
      />
    );

  const pair = async () => {
    setBusy(true);
    setErr("");
    try {
      await api("/api/admin/kiosks/pair", { method: "POST", json: { name } });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid-bg flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-5 p-7">
        <Logo />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pair this device as a kiosk</h1>
        </div>
        {s.admin ? (
          <>
            {s.admin.org && (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                Organization: <strong>{s.admin.org}</strong>
              </p>
            )}
            <Field label="Kiosk name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </Field>
            {err && <p className="text-sm text-danger">{err}</p>}
            <Button className="w-full" onClick={pair} loading={busy} disabled={!name.trim()}>
              Pair &amp; start kiosk
            </Button>
          </>
        ) : (
          <Link href="/login?next=/kiosk" className="block">
            <Button className="w-full">Sign in as admin to pair</Button>
          </Link>
        )}
      </Card>
    </div>
  );
}
