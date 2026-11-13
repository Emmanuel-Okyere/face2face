"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useOrg } from "@/components/AdminShell";
import { useOrgFields } from "@/components/FieldsEditor";
import { FieldValue, PersonFieldsForm, personToForm, valueOf, type FormValues } from "@/components/PersonFields";
import { api, Avatar, Button, Card, cx, Empty, fmtTime, Pill, Spinner, OrgLogo } from "@/components/ui";
import { enabledFields } from "@/lib/person-fields";
import { ask, toast } from "@/components/feedback";

const EnrollCapture = dynamic(() => import("@/components/EnrollCapture"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center py-10">
      <Spinner />
    </div>
  ),
});

type Detail = {
  person: {
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
    consent_at: string | null;
    is_visitor: boolean;
    invited_by: string | null;
    qr_version: number;
    created_at: string;
  };
  embeddings: { id: number; quality: number | null; pose: string | null; created_at: string }[];
  history: { id: number; day: string; checked_in_at: string; method: string; distance: number | null; note: string | null; late: boolean; service: string }[];
};

function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [enrolling, setEnrolling] = useState(sp.get("enroll") === "1");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api<Detail>(`/api/admin/people/${id}`).then(setD).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (err) return <Empty title="Couldn't load this person">{err}</Empty>;
  if (!d)
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  const p = d.person;

  const toggleActive = async () => {
    await api(`/api/admin/people/${id}`, { method: "PATCH", json: { active: !p.active } });
    load();
  };
  const remove = async () => {
    if (!(await ask({ title: `Delete ${p.full_name}?`, body: "Their face data and attendance history are deleted too. This can't be undone.", confirm: "Delete", danger: true }))) return;
    await api(`/api/admin/people/${id}`, { method: "DELETE" });
    toast(`${p.full_name} deleted`);
    router.replace("/admin/people");
  };
  const clearFace = async () => {
    if (!(await ask({ title: "Remove face data?", body: "Their face data and photo are deleted. They'll need to re-enroll or use their QR badge.", confirm: "Remove", danger: true }))) return;
    await api(`/api/admin/people/${id}/enroll`, { method: "DELETE" });
    toast("Face data removed");
    load();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="flex flex-wrap items-center gap-5">
        <Avatar src={p.avatar} name={p.full_name} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl tracking-tight">{p.full_name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <CopyId value={p.ref} />
            {p.code && <span>· {p.code}</span>}
            {p.group_name && <span>· {p.group_name}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.is_visitor && <Pill tone="info">Visitor{p.invited_by ? ` · invited by ${p.invited_by}` : ""}</Pill>}
            {d.embeddings.length ? <Pill tone="good">Face enrolled · {d.embeddings.length} photos</Pill> : !p.is_visitor && <Pill tone="warn">No face data</Pill>}
            {!p.active && <Pill tone="danger">Inactive</Pill>}
            {p.consent_at && <Pill>Consent {new Date(p.consent_at).toLocaleDateString()}</Pill>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.is_visitor && (
            <Button
              onClick={async () => {
                if (!(await ask({ title: `Make ${p.full_name} a member?`, body: "They'll count in attendance rates and reports from now on. You can then enroll their face.", confirm: "Make member" }))) return;
                await api(`/api/admin/people/${id}`, { method: "PATCH", json: { is_visitor: false } });
                toast(`${p.full_name} is now a member`);
                load();
              }}
            >
              Make member
            </Button>
          )}
          <Button variant="ghost" onClick={() => setEditing((e) => !e)}>
            Edit
          </Button>
          <Button variant="ghost" onClick={toggleActive}>
            {p.active ? "Deactivate" : "Reactivate"}
          </Button>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
        </div>
      </Card>

      {editing ? <EditCard p={p} onSaved={() => (setEditing(false), load())} onCancel={() => setEditing(false)} /> : <DetailsCard p={p} />}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium">Face enrollment</h2>
            </div>
            {!enrolling && (
              <div className="flex gap-2">
                {d.embeddings.length > 0 && (
                  <Button variant="subtle" onClick={clearFace}>
                    Remove
                  </Button>
                )}
                <Button onClick={() => setEnrolling(true)}>{d.embeddings.length ? "Re-enroll" : "Enroll now"}</Button>
              </div>
            )}
          </div>
          {enrolling ? (
            <EnrollCapture
              personId={p.id}
              personName={p.full_name}
              onDone={() => {
                setEnrolling(false);
                load();
              }}
            />
          ) : d.embeddings.length ? (
            <div className="flex flex-wrap gap-2">
              {d.embeddings.map((e) => (
                <div key={e.id} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2 text-xs">
                  <div className="font-medium capitalize">{e.pose || "photo"}</div>
                  <div className="text-muted">quality {e.quality != null ? Math.round(e.quality * 100) : "—"}%</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Not enrolled yet.</p>
          )}
        </Card>

        <Badge person={p} />
      </div>

      <Card>
        <h2 className="mb-1 font-medium">Attendance history</h2>
        <Heatstrip days={d.history.map((h) => h.day)} />
        {d.history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No check-ins yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line/70 text-sm">
            {d.history.slice(0, 15).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  {new Date(h.day + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
                  <span className="ml-2 text-muted">{h.service}</span>
                </span>
                <span className="flex items-center gap-2">
                  {h.note && <span className="hidden text-xs text-muted sm:inline">“{h.note}”</span>}
                  <Pill>{({ face: "Face", qr: "QR badge", link: "Phone", manual: "Manual" } as Record<string, string>)[h.method] ?? h.method}</Pill>
                  {h.late && <Pill tone="warn">Late</Pill>}
                  <span className="font-mono text-xs">{fmtTime(h.checked_in_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DetailsCard({ p }: { p: Detail["person"] }) {
  const fields = useOrgFields();
  if (!fields) return null;
  const shown = enabledFields(fields).filter((f) => f.key !== "full_name");
  if (!shown.length) return null;
  return (
    <Card>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((f) => (
          <div key={f.key} className="min-w-0">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="mt-0.5 truncate text-sm">
              <FieldValue field={f} value={valueOf(f, p)} />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function EditCard({ p, onSaved, onCancel }: { p: Detail["person"]; onSaved: () => void; onCancel: () => void }) {
  const fields = useOrgFields();
  const [values, setValues] = useState<FormValues>(() => personToForm(p));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (!fields) return;
    setBusy(true);
    setErr("");
    setErrors({});
    // Send exactly the org's enabled fields (empty = clear).
    const body = Object.fromEntries(enabledFields(fields).map((f) => [f.key, values[f.key] ?? null]));
    try {
      await api(`/api/admin/people/${p.id}`, { method: "PATCH", json: body });
      onSaved();
    } catch (e) {
      const fe = (e as { data?: { fieldErrors?: Record<string, string> } }).data?.fieldErrors;
      if (fe) setErrors(fe);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {!fields ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <PersonFieldsForm fields={fields} values={values} onChange={setValues} errors={errors} />
          <div className="flex items-center justify-end gap-3">
            {err && !Object.keys(errors).length && <span className="text-sm text-danger">{err}</span>}
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Badge({ person }: { person: Detail["person"] }) {
  const org = useOrg();
  const [qr, setQr] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const render = async (token: string) =>
    setQr(await QRCode.toDataURL(token, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#1c1b18", light: "#ffffff" } }));

  useEffect(() => {
    api<{ token: string; link: string | null }>(`/api/admin/people/${person.id}/badge`).then((r) => {
      setLink(r.link);
      render(r.token);
    });
  }, [person.id, person.qr_version]);

  const reissue = async () => {
    if (!(await ask({ title: "Issue a new badge and link?", body: "The current badge and personal link stop working immediately.", confirm: "Issue new", danger: true }))) return;
    setBusy(true);
    const r = await api<{ token: string; link: string | null }>(`/api/admin/people/${person.id}/badge`, { method: "POST" });
    setLink(r.link);
    await render(r.token);
    setBusy(false);
  };

  const print = () => {
    document.body.classList.add("print-badge");
    window.print();
    setTimeout(() => document.body.classList.remove("print-badge"), 500);
  };

  return (
    <Card>
      <h2 className="font-medium">QR badge &amp; personal link</h2>
      <div id="badge" className="mx-auto w-[260px] overflow-hidden rounded-3xl border border-line bg-white text-center text-[#1c1b18]">
        <div className="flex items-center gap-2.5 bg-[#1c1b18] px-4 py-3 text-left text-xs text-white">
          <span className="rounded-lg bg-white p-0.5">
            <OrgLogo src={org?.logoUrl} name={org?.name ?? "Organization"} size={26} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{org?.name ?? "Face2Face"}</span>
            <span className="text-white/60">attendance badge</span>
          </span>
        </div>
        <div className="p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Badge QR code" className="mx-auto size-48" />
          ) : (
            <div className="flex size-48 items-center justify-center">
              <Spinner />
            </div>
          )}
          <div className="mt-2 text-lg font-semibold leading-tight">{person.full_name}</div>
          <div className="text-xs text-[#8a867b]">
            <span className="font-mono">{person.ref}</span>
            {person.code ? ` · ${person.code}` : ""}
            {person.group_name ? ` · ${person.group_name}` : ""}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="ghost" onClick={print} disabled={!qr}>
          Print
        </Button>
        {qr && (
          <a href={qr} download={`badge-${person.ref}.png`}>
            <Button variant="ghost">Download</Button>
          </a>
        )}
        <Button variant="subtle" onClick={reissue} loading={busy}>
          Reissue
        </Button>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <div className="text-xs font-medium">Personal phone check-in link</div>
        {link ? (
          <>
            <div className="mt-2 flex gap-2">
              <input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-1.5 font-mono text-[11px]" />
              <Button
                variant="ghost"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-0.5 text-xs text-muted">Off. Turn on in Settings.</p>
        )}
      </div>
    </Card>
  );
}

function CopyId({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title="Platform ID — unique across Face2Face. Click to copy."
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs tracking-wide text-ink hover:bg-line"
    >
      {done ? "Copied" : value}
    </button>
  );
}

/** Last 8 weeks as a GitHub-style strip. */
function Heatstrip({ days }: { days: string[] }) {
  const set = new Set(days);
  const cells = Array.from({ length: 56 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (55 - i));
    const key = d.toLocaleDateString("en-CA");
    return { key, on: set.has(key), weekend: d.getDay() === 0 || d.getDay() === 6 };
  });
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ gridTemplateColumns: "repeat(8, 14px)" }} aria-label="Attendance, last 8 weeks">
      {cells.map((c) => (
        <span key={c.key} title={c.key} className={cx("size-3.5 rounded-[4px]", c.on ? "bg-good" : c.weekend ? "bg-surface-2" : "hatch bg-surface-2")} />
      ))}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <PersonPage />
    </Suspense>
  );
}
