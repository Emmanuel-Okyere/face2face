"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { api, Avatar, Button, Card, cx, Empty, fmtTime, Input, Pill, Spinner } from "@/components/ui";
import { ask, toast } from "@/components/feedback";

type Row = {
  id: number;
  day: string;
  service: string;
  checked_in_at: string;
  method: "face" | "qr" | "manual" | "link" | "visitor";
  distance: number | null;
  margin: number | null;
  note: string | null;
  person_id: string;
  ref: string;
  code: string | null;
  full_name: string;
  group_name: string | null;
  avatar: string | null;
  kiosk: string | null;
  recorded_by: string | null;
  late: boolean;
};

const today = () => new Date().toLocaleDateString("en-CA");

export default function AttendanceLog() {
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [method, setMethod] = useState("");
  const [service, setService] = useState("");
  const [services, setServices] = useState<{ id: string; name: string; active: boolean }[]>([]);
  useEffect(() => {
    api<{ services: { id: string; name: string; active: boolean }[] }>("/api/admin/services").then((r) => setServices(r.services));
  }, []);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: Row[]; total: number; pageSize: number } | null>(null);

  const qs = `from=${from}&to=${to}&method=${method}&service=${service}&q=${encodeURIComponent(q)}`;
  const load = useCallback(() => {
    api<{ rows: Row[]; total: number; pageSize: number }>(`/api/admin/attendance?${qs}&page=${page}`).then(setData);
  }, [qs, page]);

  useEffect(() => {
    const t = setTimeout(load, 180);
    return () => clearTimeout(t);
  }, [load]);

  const undo = async (r: Row) => {
    if (!(await ask({ title: `Remove ${r.full_name}'s check-in?`, body: `On ${r.day}.`, confirm: "Remove", danger: true }))) return;
    await api(`/api/admin/attendance/manual?id=${r.id}`, { method: "DELETE" });
    toast("Check-in removed");
    load();
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Attendance log"
        subtitle={data ? `${data.total} check-in${data.total === 1 ? "" : "s"}` : " "}
        actions={
          <a href={`/api/admin/attendance?${qs}&format=csv`}>
            <Button>
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
              </svg>
              Export CSV
            </Button>
          </a>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs rounded-full" placeholder="Search name, ID, platform ID or group…" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
        <div className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm">
          <input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} className="bg-transparent outline-none" aria-label="From" />
          <span className="text-muted">→</span>
          <input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} className="bg-transparent outline-none" aria-label="To" />
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm">
          {[
            ["", "All"],
            ["face", "Face"],
            ["qr", "QR"],
            ["manual", "Manual"],
            ["link", "Phone"],
            ["visitor", "Visitors"],
          ].map(([v, l]) => (
            <button key={v} onClick={() => (setMethod(v), setPage(1))} className={cx("rounded-full px-3 py-1", method === v ? "bg-ink text-white" : "text-muted hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        {services.length > 1 && (
          <select
            value={service}
            onChange={(e) => (setService(e.target.value), setPage(1))}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm"
            aria-label="Service"
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (archived)"}
              </option>
            ))}
          </select>
        )}
      </div>

      {!data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : data.rows.length === 0 ? (
        <Empty title="No check-ins in this range" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-normal">Person</th>
                  <th className="px-3 py-3 font-normal">Date</th>
                  <th className="px-3 py-3 font-normal">Check in</th>
                  <th className="px-3 py-3 font-normal">Method</th>
                  <th className="px-3 py-3 font-normal">Where / who</th>
                  <th className="px-3 py-3 font-normal">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {data.rows.map((r) => (
                  <tr key={r.id} className="group">
                    <td className="px-5 py-3">
                      <a href={`/admin/people/${r.person_id}`} className="flex items-center gap-3">
                        <Avatar src={r.avatar} name={r.full_name} size={34} />
                        <div>
                          <div className="font-medium">{r.full_name}</div>
                          <div className="text-xs text-muted">
                            {r.code || r.ref}
                            {r.group_name ? ` · ${r.group_name}` : ""}
                          </div>
                        </div>
                      </a>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {new Date(r.day + "T12:00:00").toLocaleDateString([], { day: "numeric", month: "short" })}
                      <div className="text-xs">{r.service}</div>
                    </td>
                    <td className="px-3 py-3 font-mono">{fmtTime(r.checked_in_at)}</td>
                    <td className="px-3 py-3">
                      <span title={r.distance != null ? `distance ${r.distance.toFixed(3)}${r.margin != null ? `, margin ${r.margin.toFixed(3)}` : ""}` : undefined}>
                        <Pill>
                          {r.method === "face"
                            ? `Face ${r.distance != null ? `· ${Math.round((1 - r.distance) * 100)}%` : ""}`
                            : r.method === "link"
                              ? "Phone + face"
                              : r.method === "qr"
                                ? "QR badge"
                                : r.method === "visitor"
                                  ? "Visitor"
                                  : "Manual"}
                        </Pill>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {r.kiosk ?? (r.recorded_by ? `by ${r.recorded_by}` : "—")}
                      {r.note && <div className="max-w-[220px] truncate italic">“{r.note}”</div>}
                    </td>
                    <td className="px-3 py-3">{r.late ? <Pill tone="warn">Late</Pill> : <span className="text-xs text-muted">On time</span>}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => undo(r)} className="text-xs text-muted opacity-0 transition hover:text-danger group-hover:opacity-100 focus:opacity-100">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
              <span className="text-muted">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ← Prev
                </Button>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Next →
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
