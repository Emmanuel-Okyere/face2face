"use client";

import { useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { useOrgFields } from "@/components/FieldsEditor";
import { api, Button, Card, cx, Pill, Spinner } from "@/components/ui";
import type { FieldDef } from "@/lib/person-fields";

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Common header spellings for the built-in fields.
const ALIASES: Record<string, string[]> = {
  full_name: ["name", "fullname", "membername", "studentname", "employeename"],
  code: ["code", "id", "idcode", "staffid", "studentid", "employeeid", "memberid", "membernumber", "staffnumber"],
  group_name: ["group", "department", "class", "team", "ministry", "unit"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "phonenumber", "mobile", "telephone", "tel", "cell", "whatsapp"],
  ref: ["platformid", "ref", "face2faceid"],
};

function autoMap(header: string, fields: FieldDef[]): string {
  const h = norm(header);
  if (ALIASES.ref.includes(h)) return "ref";
  const byLabel = fields.find((f) => norm(f.label) === h || norm(f.key) === h);
  if (byLabel) return byLabel.key;
  const byAlias = Object.entries(ALIASES).find(([k, a]) => k !== "ref" && a.includes(h) && fields.some((f) => f.key === k));
  return byAlias ? byAlias[0] : "";
}

export default function ImportPage() {
  return (
    <>
      <PageHeader title="Bulk import" />
      <div className="grid gap-4 xl:grid-cols-2">
        <CsvImport />
        <PhotoImport />
      </div>
    </>
  );
}

type Problem = { row: number; error: string };

function CsvImport() {
  const fieldsAll = useOrgFields();
  const fields = (fieldsAll ?? []).filter((f) => f.enabled);
  const [table, setTable] = useState<string[][] | null>(null);
  const [map, setMap] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [result, setResult] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | undefined) => {
    setErr("");
    setResult("");
    setProblems([]);
    if (!f) return;
    const t = parseCsv(await f.text());
    if (t.length < 2) return setErr("The file needs a header row and at least one person.");
    if (t.length > 5001) return setErr("Up to 5,000 people per file — split it into smaller files.");
    setTable(t);
    setMap(t[0].map((h) => autoMap(h, fields)));
  };

  const rows = table
    ? table.slice(1).map((r) => {
        const o: Record<string, string> = {};
        map.forEach((key, i) => {
          if (key && r[i]?.trim()) o[key] = r[i].trim();
        });
        return o;
      })
    : [];
  const hasName = map.includes("full_name");

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ inserted: number; updated: number; skipped: number; problems: Problem[]; problemCount: number }>("/api/admin/people/import", {
        method: "POST",
        json: { rows },
      });
      setResult(
        `✓ ${r.inserted} added, ${r.updated} updated` +
          (r.skipped ? `, ${r.skipped} duplicate rows skipped` : "") +
          (r.problemCount ? ` · ${r.problemCount} row${r.problemCount === 1 ? "" : "s"} need fixing` : ""),
      );
      setProblems(r.problems);
      if (!r.problemCount) setTable(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white">1</span>
        <h2 className="font-medium">People from CSV</h2>
      </div>
      <p className="mb-4 text-xs text-muted">Only a name column is required.</p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-sm hover:bg-surface-2">
        <span className="font-medium">Choose a .csv file</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {err && <p className="mt-3 text-sm text-danger">{err}</p>}
      {result && <p className="mt-3 text-sm text-good">{result}</p>}
      {problems.length > 0 && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-auto rounded-xl bg-danger/5 p-3 text-xs text-danger">
          {problems.map((p) => (
            <li key={p.row}>
              Row {p.row}: {p.error}
            </li>
          ))}
        </ul>
      )}
      {table && (
        <div className="mt-4 space-y-3">
          <div className="max-h-72 overflow-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line">
                  {table[0].map((h, i) => (
                    <th key={i} className="px-2 py-2 text-left align-top font-normal">
                      <div className="mb-1 truncate text-muted">{h}</div>
                      <select
                        value={map[i]}
                        onChange={(e) => setMap(map.map((m, j) => (j === i ? e.target.value : m)))}
                        className={cx("w-full rounded-lg border px-1.5 py-1", map[i] ? "border-good/40 bg-good-soft/30" : "border-line bg-surface")}
                      >
                        <option value="">— ignore —</option>
                        <option value="ref">Platform ID</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {table.slice(1, 6).map((r, i) => (
                  <tr key={i}>
                    {table[0].map((_, j) => (
                      <td key={j} className={cx("max-w-[160px] truncate px-2 py-1.5", !map[j] && "text-muted/50")}>
                        {r[j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              {rows.length} rows{table.length > 6 ? " (showing 5)" : ""}
              {!hasName && <span className="text-danger"> · map a column to “{fields.find((f) => f.key === "full_name")?.label ?? "Full name"}”</span>}
            </span>
            <Button onClick={submit} loading={busy} disabled={!hasName && !map.includes("ref")}>
              Import {rows.length}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

type Job = {
  code: string;
  files: File[];
  person?: { id: string; full_name: string; embeddings: number };
  status: "waiting" | "working" | "done" | "skipped" | "error" | "duplicate";
  msg?: string;
};

/** "ABC123.jpg", "ABC123_2.jpg", "ABC123-3.png", "ABC123 (4).jpeg" → "ABC123" */
function codeFromFilename(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/(\s*\(\d+\)|[_-]\d{1,2})$/, "")
    .trim();
}

function PhotoImport() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [consent, setConsent] = useState(false);
  const [skipEnrolled, setSkipEnrolled] = useState(true);
  const [running, setRunning] = useState(false);

  const update = (code: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.code === code ? { ...j, ...patch } : j)));

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const groups = new Map<string, File[]>();
    for (const f of Array.from(list)) {
      if (!/^image\//.test(f.type)) continue;
      const c = codeFromFilename(f.name);
      groups.set(c, [...(groups.get(c) || []), f]);
    }
    const codes = [...groups.keys()];
    const { matches } = await api<{ matches: Record<string, { id: string; full_name: string; embeddings: number }> }>("/api/admin/people/lookup", {
      method: "POST",
      json: { codes },
    });
    const byCode = new Map(Object.entries(matches));
    setJobs(
      codes.sort().map((code) => {
        const person = byCode.get(code);
        return {
          code,
          files: groups.get(code)!.slice(0, 5),
          person,
          status: person ? "waiting" : "error",
          msg: person ? undefined : "No person with this ID — import the CSV first",
        };
      }),
    );
  };

  const run = async () => {
    setRunning(true);
    const { analysePhoto, MIN_SAMPLES } = await import("@/components/EnrollCapture");
    const { loadFaceApi } = await import("@/lib/face/engine");
    await loadFaceApi();
    for (const j of jobs) {
      if (j.status !== "waiting" || !j.person) continue;
      if (skipEnrolled && j.person.embeddings > 0) {
        update(j.code, { status: "skipped", msg: "Already enrolled" });
        continue;
      }
      update(j.code, { status: "working" });
      const samples = [];
      const problems: string[] = [];
      for (const f of j.files) {
        const r = await analysePhoto(f);
        if ("error" in r) problems.push(`${f.name}: ${r.error}`);
        else samples.push(r);
      }
      if (samples.length < MIN_SAMPLES) {
        update(j.code, { status: "error", msg: `Only ${samples.length} usable photo(s), need ${MIN_SAMPLES}. ${problems.join("; ")}` });
        continue;
      }
      try {
        await api(`/api/admin/people/${j.person.id}/enroll`, {
          method: "POST",
          json: {
            samples: samples.map(({ descriptor, quality, pose }) => ({ descriptor, quality: Math.min(1, quality), pose })),
            avatar: samples[0].thumb,
            consent: true,
          },
        });
        update(j.code, { status: "done", msg: `${samples.length} photos enrolled` });
      } catch (e) {
        const dup = (e as { data?: { duplicate?: { full_name: string; code: string } } }).data?.duplicate;
        update(j.code, dup ? { status: "duplicate", msg: `Looks like ${dup.full_name} (${dup.code}) — enroll manually to confirm` } : { status: "error", msg: (e as Error).message });
      }
    }
    setRunning(false);
  };

  const counts = jobs.reduce<Record<string, number>>((a, j) => ((a[j.status] = (a[j.status] || 0) + 1), a), {});
  const tone = { waiting: "muted", working: "info", done: "good", skipped: "muted", error: "danger", duplicate: "warn" } as const;

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-ink text-xs text-white">2</span>
        <h2 className="font-medium">Face photos by file name</h2>
      </div>
      <p className="mb-4 text-xs text-muted">
        Name each file by ID, e.g. <code>K7QM-4XHT_1.jpg</code>, <code>K7QM-4XHT_2.jpg</code> (3–5 per person).
      </p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface-2/40 px-4 py-8 text-sm hover:bg-surface-2">
        <span className="font-medium">Choose photos</span>
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>

      {jobs.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Pill>{jobs.length} people</Pill>
            {counts.done && <Pill tone="good">{counts.done} done</Pill>}
            {counts.error && <Pill tone="danger">{counts.error} problems</Pill>}
            {counts.duplicate && <Pill tone="warn">{counts.duplicate} possible duplicates</Pill>}
          </div>
          <ul className="max-h-72 divide-y divide-line/70 overflow-auto rounded-xl border border-line text-sm">
            {jobs.map((j) => (
              <li key={j.code} className="flex items-center gap-3 px-3 py-2">
                <span className="w-24 shrink-0 truncate font-mono text-xs">{j.code}</span>
                <span className="min-w-0 flex-1 truncate">
                  {j.person?.full_name ?? "—"}
                  {j.msg && <span className={cx("block truncate text-xs", j.status === "done" ? "text-good" : "text-muted")}>{j.msg}</span>}
                </span>
                <span className="text-xs text-muted">{j.files.length} 📷</span>
                {j.status === "working" ? <Spinner className="size-3.5" /> : <Pill tone={tone[j.status]}>{j.status}</Pill>}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skipEnrolled} onChange={(e) => setSkipEnrolled(e.target.checked)} className="size-4 accent-[var(--ink)]" />
            Skip people who are already enrolled
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
            I confirm everyone in this batch has consented to face-based attendance.
          </label>
          <Button onClick={run} loading={running} disabled={!consent || running || !jobs.some((j) => j.status === "waiting")}>
            Enroll {jobs.filter((j) => j.status === "waiting").length} people
          </Button>
        </div>
      )}
    </Card>
  );
}
