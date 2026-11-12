"use client";

import { useParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState } from "react";
import { api, Card, Logo, OrgLogo, Spinner } from "@/components/ui";
import { countdown, dateRange, daysLabel, eventDays, roomLabel } from "@/lib/camp/format";

type Person = {
  name: string;
  code: string;
  ageGroup: string | null;
  room: { building: string; name: string; bed: number } | null;
  bus: { name: string; seat: number; pickup: string | null; departs: string | null } | null;
  needsBus: boolean;
  days: string[] | null;
};
type Pass = {
  org: { name: string; logoUrl: string | null };
  event: { name: string; venue: string | null; starts_on: string | null; ends_on: string | null };
  registration: { code: string; church: string; contact: string };
  people: Person[];
};

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: "M", color: { dark: "#1d1d1b", light: "#ffffff" } }).then(setSrc);
  }, [text]);
  // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing to optimise
  return src ? <img src={src} alt={`QR code ${text}`} className="size-24 rounded-lg" /> : <div className="size-24 rounded-lg bg-surface-2" />;
}

function PassView() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Pass | null>(null);
  const [bad, setBad] = useState("");
  useEffect(() => {
    api<Pass>(`/api/pass/${token}`).then(setP).catch((e) => setBad(e.message));
  }, [token]);

  if (bad)
    return (
      <Shell>
        <Card className="p-8 text-center">
          <h1 className="text-lg font-semibold">Pass not found</h1>
          <p className="mt-1 text-sm text-muted">{bad}</p>
        </Card>
      </Shell>
    );
  if (!p)
    return (
      <Shell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Shell>
    );

  const soon = countdown(p.event.starts_on, p.event.ends_on);
  const roomed = p.people.filter((x) => x.room).length;
  return (
    <Shell>
      <header className="mb-5 flex items-start gap-3">
        <OrgLogo src={p.org.logoUrl} name={p.org.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{p.org.name}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{p.event.name}</h1>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
            {dateRange(p.event.starts_on, p.event.ends_on) && <span>{dateRange(p.event.starts_on, p.event.ends_on)}</span>}
            {p.event.venue && <span>{p.event.venue}</span>}
          </div>
        </div>
        {soon && <div className="shrink-0 pt-1 text-sm font-medium text-[#2e7d4f]">{soon}</div>}
      </header>

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-xs text-muted">Registration code</div>
          <div className="font-mono text-xl font-semibold tracking-wider">{p.registration.code}</div>
        </div>
        <div className="text-right text-sm">
          <div>{p.registration.church}</div>
          <div className="text-xs text-muted">
            {p.people.length} {p.people.length === 1 ? "person" : "people"}
            {roomed < p.people.length && " · rooms coming soon"}
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {p.people.map((x) => (
          <article key={x.code} className="card-shadow flex overflow-hidden rounded-3xl border border-line bg-surface">
            <div className="min-w-0 flex-1 space-y-3 p-5">
              <div>
                <h2 className="truncate text-lg font-semibold leading-tight">{x.name}</h2>
                <div className="text-xs text-muted">
                  {x.ageGroup ? `${x.ageGroup} · ` : ""}
                  {daysLabel(x.days, eventDays(p.event.starts_on, p.event.ends_on)) && `${daysLabel(x.days, eventDays(p.event.starts_on, p.event.ends_on))} · `}
                  <span className="font-mono">{x.code}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Slot label="Room" value={x.room ? roomLabel(x.room) : null} sub={x.room ? `Bed ${x.room.bed}` : null} pending="Not yet allocated" />
                {x.needsBus || x.bus ? (
                  <Slot
                    label="Bus"
                    value={x.bus ? x.bus.name : null}
                    sub={x.bus ? [`Seat ${x.bus.seat}`, x.bus.departs].filter(Boolean).join(" · ") : null}
                    pending="Seat coming soon"
                  />
                ) : (
                  <Slot label="Bus" value="Own transport" sub={null} pending="" />
                )}
              </div>
              {x.bus?.pickup && <div className="text-xs text-muted">Pickup: {x.bus.pickup}</div>}
            </div>
            {/* Ticket stub: the code scanned at the gate and on the bus. */}
            <div className="flex flex-col items-center justify-center gap-1 border-l border-dashed border-line bg-surface-2/50 px-4">
              <Qr text={x.code} />
            </div>
          </article>
        ))}
      </div>

      <div className="mt-6 flex justify-center print:hidden">
        <button onClick={() => print()} className="rounded-full border border-line bg-surface px-5 py-2 text-sm hover:bg-surface-2">
          Print pass
        </button>
      </div>
    </Shell>
  );
}

function Slot({ label, value, sub, pending }: { label: string; value: string | null; sub: string | null; pending: string }) {
  return (
    <div className="rounded-2xl bg-surface-2/70 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      {value ? (
        <>
          <div className="font-medium leading-tight">{value}</div>
          {sub && <div className="text-xs text-muted">{sub}</div>}
        </>
      ) : (
        <div className="text-xs text-muted">{pending}</div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid-bg min-h-dvh px-4 py-8 print:bg-white">
      <div className="mx-auto max-w-xl">{children}</div>
      <div className="mx-auto mt-10 flex max-w-xl justify-center opacity-60 print:hidden">
        <Logo />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PassView />
    </Suspense>
  );
}
