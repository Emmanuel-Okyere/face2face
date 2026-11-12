"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { api, Button, Card, Empty, Field, Input, Pill, Spinner } from "@/components/ui";
import { countdown, dateRange } from "@/lib/camp/format";

type Row = { id: string; name: string; venue: string | null; starts_on: string | null; ends_on: string | null; registration_open: boolean; archived: boolean; people: number; households: number; roomed: number };

export default function Events() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ name: "", venue: "", starts_on: "", ends_on: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ events: Row[] }>("/api/admin/events").then((r) => setRows(r.events));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ id: string }>("/api/admin/events", { method: "POST", json: f });
      router.push(`/admin/events/${r.id}?tab=setup`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Events" actions={!adding && <Button onClick={() => setAdding(true)}>+ New event</Button>} />
      {adding && (
        <Card className="mb-4">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Camp Meeting 2026" />
            </Field>
            <Field label="Venue (optional)">
              <Input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />
            </Field>
            <Field label="Starts (optional)">
              <Input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
            </Field>
            <Field label="Ends (optional)">
              <Input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
            </Field>
            {err && <p className="text-sm text-danger sm:col-span-2">{err}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Create
              </Button>
            </div>
          </form>
        </Card>
      )}
      {!rows ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : rows.length === 0 && !adding ? (
        <Empty title="No events yet">Create one for your camp meeting, convention or retreat.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((e) => {
            const soon = countdown(e.starts_on, e.ends_on);
            return (
              <Link key={e.id} href={`/admin/events/${e.id}`} className={`card-shadow block rounded-3xl border border-line bg-surface p-5 transition hover:border-ink/20 ${e.archived ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{e.name}</div>
                    <div className="text-sm text-muted">{[dateRange(e.starts_on, e.ends_on), e.venue].filter(Boolean).join(" · ") || "No date yet"}</div>
                  </div>
                  {e.archived ? <Pill>Archived</Pill> : e.registration_open ? <Pill tone="good">Open</Pill> : <Pill>Closed</Pill>}
                </div>
                <div className="mt-4 flex items-end gap-6">
                  <Stat n={e.people} label="people" />
                  <Stat n={e.households} label="registrations" />
                  {soon && <span className="ml-auto text-xs font-medium text-good">{soon}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums leading-none">{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
