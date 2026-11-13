"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/feedback";
import { api, Avatar, Button, Input, Pill } from "@/components/ui";

type P = { id: string; code: string | null; ref: string; full_name: string; group_name: string | null; avatar: string | null };
type S = { id: string; name: string; start: string; end: string; open: boolean };

/** Admin-vouched check-in for anyone the camera and badge can't handle. */
export default function ManualCheckIn({ onDone }: { onDone?: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<P[]>([]);
  const [note, setNote] = useState("");
  const [services, setServices] = useState<S[] | null>(null);
  const [service, setService] = useState("");
  const [done, setDone] = useState<Record<string, string>>({}); // personId → result text
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [visitor, setVisitor] = useState<{ full_name: string; phone: string; invited_by: string } | null>(null);

  const addVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visitor) return;
    setBusy("visitor");
    setErr("");
    try {
      const r = await api<{ person: { full_name: string }; visits: number; visitor: boolean; status: string }>("/api/admin/attendance/visitor", {
        method: "POST",
        json: { ...visitor, serviceId: service || undefined },
      });
      toast(
        !r.visitor
          ? `${r.person.full_name} is a member — checked in`
          : r.visits <= 1
            ? `${r.person.full_name} checked in · first visit`
            : `${r.person.full_name} checked in · visit ${r.visits}`,
      );
      setVisitor(null);
      setQ("");
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    api<{ services: S[] }>("/api/admin/attendance/manual").then((r) => {
      setServices(r.services);
      setService((r.services.find((s) => s.open) ?? r.services[0])?.id ?? "");
    });
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      api<{ people: P[] }>(`/api/admin/people?q=${encodeURIComponent(q.trim())}`).then((r) => setRows(r.people.slice(0, 6)));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const checkIn = async (p: P) => {
    setBusy(p.id);
    setErr("");
    try {
      const r = await api<{ status: string; at: string; late: boolean }>("/api/admin/attendance/manual", {
        method: "POST",
        json: { personId: p.id, serviceId: service || undefined, note: note || undefined },
      });
      const time = new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setDone((d) => ({ ...d, [p.id]: r.status === "already" ? `Already in · ${time}` : `In · ${time}` }));
      setNote("");
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (services && services.length === 0) return <p className="text-sm text-muted">No services today.</p>;

  return (
    <div className="space-y-3">
      {services && services.length > 1 && (
        <select value={service} onChange={(e) => (setService(e.target.value), setDone({}))} className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" aria-label="Service">
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.start}–{s.end}
              {s.open ? " · open" : ""}
            </option>
          ))}
        </select>
      )}
      <Input placeholder="Search name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Input placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="text-sm text-danger">{err}</p>}
      {visitor ? (
        <form onSubmit={addVisitor} className="space-y-2 rounded-2xl border border-line p-3">
          <div className="text-xs font-medium text-muted">New visitor</div>
          <Input required autoFocus placeholder="Name" value={visitor.full_name} onChange={(e) => setVisitor({ ...visitor, full_name: e.target.value })} />
          <Input type="tel" placeholder="Phone (optional)" value={visitor.phone} onChange={(e) => setVisitor({ ...visitor, phone: e.target.value })} />
          <Input placeholder="Invited by (optional)" value={visitor.invited_by} onChange={(e) => setVisitor({ ...visitor, invited_by: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setVisitor(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === "visitor"}>
              Check in visitor
            </Button>
          </div>
        </form>
      ) : (
        <button onClick={() => setVisitor({ full_name: q.trim().length >= 2 && !rows.length ? q.trim() : "", phone: "", invited_by: "" })} className="text-xs text-muted hover:text-ink">
          + Visitor{q.trim().length >= 2 && !rows.length ? ` — add “${q.trim()}”` : ""}
        </button>
      )}
      <ul className="divide-y divide-line">
        {(q.trim().length < 2 ? [] : rows).map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <Avatar src={p.avatar} name={p.full_name} size={30} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{p.full_name}</div>
              <div className="text-xs text-muted">
                {p.code || p.ref}
                {p.group_name ? ` · ${p.group_name}` : ""}
              </div>
            </div>
            {done[p.id] ? (
              <Pill tone="good">{done[p.id]}</Pill>
            ) : (
              <Button variant="ghost" className="px-2.5 py-1 text-xs" loading={busy === p.id} onClick={() => checkIn(p)}>
                Check in
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
