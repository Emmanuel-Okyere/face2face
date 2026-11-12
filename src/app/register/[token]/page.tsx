"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import RegistrationForm, { blankRegistration, checkRegistration, toPayload, type EventInfo, type RegistrationDraft } from "@/components/camp/RegistrationForm";
import { api, Button, Card, Logo, OrgLogo, Spinner } from "@/components/ui";
import { countdown, dateRange } from "@/lib/camp/format";

type Info = {
  org: { name: string; logoUrl: string | null };
  event: EventInfo & { name: string; venue: string | null; starts_on: string | null; ends_on: string | null; open: boolean };
};

function Register() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [bad, setBad] = useState("");
  const [f, setF] = useState<RegistrationDraft>(blankRegistration);
  const [hp, setHp] = useState(""); // honeypot
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ code: string; pass: string } | null>(null);

  useEffect(() => {
    api<Info>(`/api/events/${token}`).then(setInfo).catch((e) => setBad(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkRegistration(f, info!.event.days, info!.event.form);
    if (problem) return setErr(problem);
    if (!f.contact_phone) return setErr("Enter a phone number so we can send your pass");
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ code: string; pass: string }>(`/api/events/${token}`, { method: "POST", json: { ...toPayload(f, info!.event.days, info!.event.form, info!.event.buses), website: hp } });
      setDone(r);
      scrollTo({ top: 0 });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (bad)
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-lg font-semibold">Link not valid</h1>
          <p className="mt-1 text-sm text-muted">{bad}</p>
        </Card>
      </Shell>
    );
  if (!info)
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  const { event, org } = info;
  const when = dateRange(event.starts_on, event.ends_on);
  const soon = countdown(event.starts_on, event.ends_on);

  return (
    <Shell>
      <header className="mb-6 flex items-center gap-3">
        <OrgLogo src={org.logoUrl} name={org.name} size={44} />
        <div className="min-w-0">
          <div className="text-xs text-muted">{org.name}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.name}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
            {when && <span>{when}</span>}
            {event.venue && <span>{event.venue}</span>}
            {soon && <span className="font-medium text-good">{soon}</span>}
          </div>
        </div>
      </header>

      {done ? (
        <Card className="space-y-5 p-7 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-good-soft">
            <svg viewBox="0 0 24 24" className="size-7 text-good" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold">You&apos;re registered</h2>
            <p className="mt-1 text-sm text-muted">Your pass is on its way by SMS. Rooms and bus seats will show on it once they&apos;re allocated.</p>
          </div>
          <div className="mx-auto w-fit rounded-2xl bg-surface-2 px-5 py-3">
            <div className="text-xs text-muted">Registration code</div>
            <div className="font-mono text-2xl font-semibold tracking-wider">{done.code}</div>
          </div>
          <Link href={done.pass} className="inline-flex rounded-full bg-ink px-6 py-3 font-medium text-white hover:bg-ink/85">
            Open my pass
          </Link>
        </Card>
      ) : !event.open || !event.churches.length ? (
        <Card className="p-8 text-center">
          <h2 className="text-lg font-semibold">{event.open ? "Registration opens soon" : "Registration is closed"}</h2>
          <p className="mt-1 text-sm text-muted">Contact the organizers if you still need to register.</p>
        </Card>
      ) : (
        <form onSubmit={submit} className="space-y-6">
          <Card className="p-5 sm:p-6">
            <RegistrationForm event={event} value={f} onChange={setF} />
          </Card>
          {/* Hidden from people; bots fill it in. */}
          <input tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={hp} onChange={(e) => setHp(e.target.value)} name="website" />
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" loading={busy} className="w-full py-3 text-base">
            Register {f.members.length > 1 ? `${f.members.length} people` : ""}
          </Button>
        </form>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg min-h-dvh px-4 py-8">
      <div className="mx-auto max-w-2xl">{children}</div>
      <div className="mx-auto mt-10 flex max-w-2xl justify-center opacity-60">
        <Logo />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Register />
    </Suspense>
  );
}
