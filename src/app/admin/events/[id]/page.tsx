"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import type { EventData } from "@/components/camp/types";
import { api, Button, cx, Spinner } from "@/components/ui";
import { countdown, dateRange } from "@/lib/camp/format";

const tabs = {
  people: dynamic(() => import("@/components/camp/People")),
  insights: dynamic(() => import("@/components/camp/Insights")),
  rooms: dynamic(() => import("@/components/camp/Rooms")),
  buses: dynamic(() => import("@/components/camp/Buses")),
  messages: dynamic(() => import("@/components/camp/Messages")),
  setup: dynamic(() => import("@/components/camp/Setup")),
};
type Tab = keyof typeof tabs;
const LABELS: Record<Tab, string> = { people: "People", insights: "Insights", rooms: "Rooms", buses: "Buses", messages: "Messages", setup: "Setup" };

function EventPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const wanted = (sp.get("tab") as Tab) in tabs ? (sp.get("tab") as Tab) : "people";
  const [d, setD] = useState<EventData | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(() => api<EventData>(`/api/admin/events/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (err) return <p className="py-10 text-center text-sm text-danger">{err}</p>;
  if (!d)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );

  const live = d.people.filter((p) => p.status === "registered");
  const riders = live.filter((p) => p.needs_bus);
  const beds = d.rooms.reduce((n, r) => n + r.beds, 0);
  const seats = d.buses.reduce((n, b) => n + b.seats, 0);
  const soon = countdown(d.event.starts_on, d.event.ends_on);
  // Rooms / Buses only exist for events that allocate them (Setup → Registration form).
  const shown = (Object.keys(tabs) as Tab[]).filter((t) => (t !== "rooms" || d.event.rooms_enabled) && (t !== "buses" || d.event.buses_enabled));
  const tab = shown.includes(wanted) ? wanted : "people";
  const Body = tabs[tab];

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Link href="/admin/events" className="text-muted hover:text-ink" aria-label="All events">
              ←
            </Link>
            {d.event.name}
          </span>
        }
        subtitle={[dateRange(d.event.starts_on, d.event.ends_on), d.event.venue, soon].filter(Boolean).join(" · ")}
        actions={<ShareLink url={`${d.origin}/register/${d.event.public_token}`} open={d.event.registration_open} />}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        <Tile n={live.length} label="People" sub={`${d.households.length} registrations`} />
        <Tile n={live.filter((p) => p.age !== null && p.age <= d.event.child_age).length} label="Children" sub={`${d.event.child_age} and under`} />
        {d.event.rooms_enabled && <Tile n={live.filter((p) => p.room_id).length} of={live.length} label="Have a bed" sub={beds ? `${beds} beds set up` : "No rooms yet"} />}
        {d.event.buses_enabled && <Tile n={riders.filter((p) => p.bus_id).length} of={riders.length} label="Bus seats" sub={seats ? `${seats} seats set up` : "No buses yet"} />}
        <Tile n={live.filter((p) => p.arrived_at).length} of={live.length} label="Arrived" sub="at camp" />
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 text-sm">
        {shown.map((t) => (
          <button
            key={t}
            onClick={() => router.replace(`/admin/events/${id}?tab=${t}`, { scroll: false })}
            className={cx("shrink-0 rounded-full px-4 py-1.5", tab === t ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {LABELS[t]}
          </button>
        ))}
      </nav>

      <Body d={d} reload={reload} />
    </>
  );
}

function Tile({ n, of, label, sub }: { n: number; of?: number; label: string; sub: string }) {
  const pct = of ? Math.round((n / of) * 100) : null;
  return (
    <div className="card-shadow rounded-2xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums leading-none">
        {n}
        {of !== undefined && <span className="text-base font-normal text-muted"> / {of}</span>}
      </div>
      {pct !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-good" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

/** The public registration link: copy it, open it, or download a QR for posters and bulletins. */
function ShareLink({ url, open }: { url: string; open: boolean }) {
  const [copied, setCopied] = useState(false);
  const qr = async () => {
    const png = await QRCode.toDataURL(url, { width: 1024, margin: 2 });
    const a = document.createElement("a");
    a.href = png;
    a.download = "registration-qr.png";
    a.click();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!open && <span className="text-xs text-muted">Registration closed</span>}
      <Button
        variant="ghost"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied ✓" : "Copy registration link"}
      </Button>
      <Button variant="ghost" onClick={qr}>
        QR code
      </Button>
      <a href={url} target="_blank" rel="noreferrer" className="rounded-full px-3 py-2 text-sm text-muted hover:text-ink">
        Open ↗
      </a>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <EventPage />
    </Suspense>
  );
}
