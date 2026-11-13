"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { useOrgFields } from "@/components/FieldsEditor";
import { FieldValue, valueOf } from "@/components/PersonFields";
import { api, Avatar, Button, Card, cx, Empty, fmtTime, hardNavigate, Input, Pill, Spinner } from "@/components/ui";

type Row = {
  id: string;
  ref: string;
  code: string | null;
  full_name: string;
  group_name: string | null;
  email: string | null;
  phone: string | null;
  attributes: Record<string, unknown>;
  avatar: string | null;
  active: boolean;
  embeddings: number;
  is_visitor: boolean;
  visits: number;
  today_at: string | null;
};

function People() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get("q") || "");
  const status = sp.get("status") || "all";
  const page = Number(sp.get("page") || 1);
  const fields = useOrgFields();
  const [data, setData] = useState<{ people: Row[]; total: number; pageSize: number } | null>(null);

  const setParam = (k: string, v: string) => {
    const u = new URLSearchParams(sp.toString());
    if (v) u.set(k, v);
    else u.delete(k);
    if (k !== "page") u.delete("page");
    router.replace(`/admin/people?${u}`);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ people: Row[]; total: number; pageSize: number }>(
        `/api/admin/people?q=${encodeURIComponent(q)}&status=${status}&page=${page}`,
      ).then(setData);
    }, 180);
    return () => clearTimeout(t);
  }, [q, status, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const listFields = (fields ?? []).filter((f) => f.enabled && f.showInList && f.key !== "full_name");

  return (
    <>
      <PageHeader
        title="People"
        subtitle={data ? `${data.total} ${status === "pending" ? "awaiting face enrollment" : status === "enrolled" ? "enrolled" : status === "visitors" ? (data.total === 1 ? "visitor" : "visitors") : "people"}` : " "}
        actions={
          <>
            <Button variant="ghost" onClick={() => hardNavigate("/api/admin/people?format=csv")}>
              Export
            </Button>
            <Link href="/admin/import">
              <Button variant="ghost">Bulk import</Button>
            </Link>
            <Link href="/admin/people/new">
              <Button>+ Add person</Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <Input className="rounded-full pl-9" placeholder="Search by name, ID, platform ID or group…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm">
          {[
            ["all", "All"],
            ["enrolled", "Enrolled"],
            ["pending", "Needs face"],
            ["visitors", "Visitors"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setParam("status", v === "all" ? "" : v)}
              className={cx("rounded-full px-3.5 py-1 transition", status === v ? "bg-ink text-white" : "text-muted hover:text-ink")}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : data.people.length === 0 ? (
        <Empty title="No one here yet">
          <Link className="underline" href="/admin/people/new">Add a person</Link> or{" "}
          <Link className="underline" href="/admin/import">import a CSV</Link>.
        </Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-3 font-normal">Person</th>
                  {listFields.map((f) => (
                    <th key={f.key} className="px-3 py-3 font-normal">
                      {f.label}
                    </th>
                  ))}
                  <th className="px-3 py-3 font-normal">Face data</th>
                  <th className="px-5 py-3 text-right font-normal">Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {data.people.map((p) => (
                  <tr key={p.id} className={cx("cursor-pointer transition hover:bg-surface-2/60", !p.active && "opacity-50")} onClick={() => router.push(`/admin/people/${p.id}`)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={p.avatar} name={p.full_name} size={36} />
                        <div>
                          <div className="font-medium">{p.full_name}</div>
                          <div className="font-mono text-[11px] tracking-wide text-muted">{p.ref}</div>
                        </div>
                      </div>
                    </td>
                    {listFields.map((f) => (
                      <td key={f.key} className="max-w-[220px] truncate px-3 py-3 text-sm">
                        <FieldValue field={f} value={valueOf(f, p)} compact />
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      {p.is_visitor ? (
                        <Pill tone="info">Visitor · {p.visits === 1 ? "1 visit" : `${p.visits} visits`}</Pill>
                      ) : p.embeddings ? (
                        <Pill tone="good">{p.embeddings} photos</Pill>
                      ) : (
                        <Pill tone="warn">Needs enrollment</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {p.today_at ? <Pill tone="good">Present · {fmtTime(p.today_at)}</Pill> : <Pill>Not in</Pill>}
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
                <Button variant="ghost" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
                  ← Prev
                </Button>
                <Button variant="ghost" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
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

export default function PeoplePage() {
  return (
    <Suspense>
      <People />
    </Suspense>
  );
}
