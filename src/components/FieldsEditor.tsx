"use client";

import { useEffect, useState } from "react";
import { PersonFieldsForm, type FormValues } from "@/components/PersonFields";
import { CountryPicker, flag } from "@/components/PhoneInput";
import { api, Button, Card, cx, Input, Pill, Spinner } from "@/components/ui";
import { countryName, FIELD_TYPES, newFieldKey, TYPE_LABELS, type FieldDef, type FieldType } from "@/lib/person-fields";
import type { CountryCode } from "libphonenumber-js/max";

export function useOrgFields() {
  const [fields, setFields] = useState<FieldDef[] | null>(null);
  useEffect(() => {
    api<{ fields: FieldDef[] }>("/api/admin/org/fields").then((r) => setFields(r.fields));
  }, []);
  return fields;
}

type Template = { name: string; icon: IconName; fields: Omit<FieldDef, "key" | "enabled" | "showInList">[] };
const TEMPLATES: Template[] = [
  {
    name: "Church",
    icon: "church",
    fields: [
      { label: "Date of birth", type: "date", required: false },
      { label: "Gender", type: "select", required: false, options: ["Female", "Male"] },
      { label: "Marital status", type: "select", required: false, options: ["Single", "Married", "Widowed", "Divorced"] },
      { label: "Baptized", type: "yesno", required: false },
      { label: "Emergency contact", type: "phone", required: false },
      { label: "Residential address", type: "longtext", required: false },
    ],
  },
  {
    name: "School",
    icon: "school",
    fields: [
      { label: "Date of birth", type: "date", required: false },
      { label: "Guardian name", type: "text", required: false },
      { label: "Guardian phone", type: "phone", required: false },
      { label: "Boarding", type: "yesno", required: false },
      { label: "Allergies / medical notes", type: "longtext", required: false },
    ],
  },
  {
    name: "Workplace",
    icon: "work",
    fields: [
      { label: "Job title", type: "text", required: false },
      { label: "Employment type", type: "select", required: false, options: ["Full-time", "Part-time", "Contract", "Intern"] },
      { label: "Start date", type: "date", required: false },
      { label: "Emergency contact", type: "phone", required: false },
    ],
  },
];

// Line icons drawn on a 24×24 grid, stroked with the current text colour.
const PATHS = {
  // field types
  text: "M5 7V5h14v2M12 5v14M9 19h6",
  longtext: "M4 6h16M4 10h16M4 14h16M4 18h10",
  number: "M9 4L7 20M17 4l-2 16M4 9h16M3 15h16",
  date: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  select: "M4 6h16v12H4zM9 11l3 3 3-3",
  yesno: "M3 12a5 5 0 0 1 5-5h8a5 5 0 0 1 0 10H8a5 5 0 0 1-5-5zM16 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z",
  email: "M3 6h18v12H3zM3 7l9 6 9-6",
  // templates
  church: "M12 2v5M9.5 4.5h5M5 21v-9l7-5 7 5v9M3 21h18M10 21v-3.5a2 2 0 0 1 4 0V21",
  school: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6",
  work: "M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18M11 13v2h2v-2",
} as const;
type IconName = keyof typeof PATHS;

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "size-4"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Owners decide what their organization collects about each person. */
export default function FieldsEditor({ canEdit }: { canEdit: boolean }) {
  const initial = useOrgFields();
  const [saved, setSaved] = useState<FieldDef[] | null>(null);
  const loaded = saved ?? initial;
  const [draft, setDraft] = useState<FieldDef[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FormValues>({});
  const fields = draft ?? loaded;
  const dirty = !!draft;

  if (!fields)
    return (
      <Card>
        <Spinner />
      </Card>
    );

  const update = (key: string, patch: Partial<FieldDef>) => setDraft(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  };
  const add = (type: FieldType, extra: Partial<FieldDef> = {}) => {
    const f: FieldDef = {
      key: newFieldKey(),
      label: extra.label ?? TYPE_LABELS[type],
      type,
      enabled: true,
      required: false,
      showInList: false,
      ...(type === "select" ? { options: ["Option 1", "Option 2"] } : {}),
      ...extra,
    };
    setDraft([...fields, f]);
    if (!extra.label) setOpen(f.key);
  };
  const remove = (f: FieldDef) => {
    if (!confirm(`Remove “${f.label || "this field"}”? Saved answers are kept but no longer shown.`)) return;
    setDraft(fields.filter((x) => x.key !== f.key));
    if (open === f.key) setOpen(null);
  };
  const applyTemplate = (t: Template) => {
    const existing = new Set(fields.map((f) => f.label.toLowerCase()));
    const fresh = t.fields
      .filter((f) => !existing.has(f.label.toLowerCase()))
      .map((f) => ({ ...f, key: newFieldKey(), enabled: true, showInList: false }) as FieldDef);
    setDraft([...fields, ...fresh]);
    setMsg(fresh.length ? `Added ${fresh.length} ${t.name.toLowerCase()} fields — review and save` : "Those fields are already here");
  };
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ fields: FieldDef[] }>("/api/admin/org/fields", { method: "PUT", json: { fields } });
      setSaved(r.fields); // the server's resolved copy
      setDraft(null);
      setMsg("✓ Saved — forms, lists, import and export now use these fields");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">People fields</h2>
        </div>
        {canEdit && dirty && (
          <div className="flex shrink-0 gap-2">
            <Button variant="subtle" onClick={() => (setDraft(null), setMsg(""))}>
              Discard
            </Button>
            <Button onClick={save} loading={busy}>
              Save fields
            </Button>
          </div>
        )}
      </div>
      {msg && <p className="mb-2 text-sm text-muted">{msg}</p>}

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(0,0.9fr)]">
        <div>
          <ul className="space-y-2">
            {fields.map((f, i) => {
              const isName = f.key === "full_name";
              const expanded = open === f.key;
              return (
                <li key={f.key} className={cx("rounded-2xl border bg-surface transition", f.enabled ? "border-line" : "border-dashed border-line/80 opacity-60")}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex flex-col">
                      <button type="button" disabled={!canEdit || i === 0} onClick={() => move(i, -1)} className="text-[10px] leading-none text-muted hover:text-ink disabled:opacity-20" aria-label="Move up">
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || i === fields.length - 1}
                        onClick={() => move(i, 1)}
                        className="text-[10px] leading-none text-muted hover:text-ink disabled:opacity-20"
                        aria-label="Move down"
                      >
                        ▼
                      </button>
                    </div>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink/70" title={TYPE_LABELS[f.type]}>
                      <Icon name={f.type} className="size-3.5" />
                    </span>
                    {/* Click the name to rename it. */}
                    <label className="group/name relative flex min-w-0 flex-1 items-center">
                      <input
                        value={f.label}
                        disabled={!canEdit}
                        maxLength={60}
                        placeholder="Field name"
                        onChange={(e) => update(f.key, { label: e.target.value })}
                        className="w-full min-w-0 rounded-lg border border-transparent bg-transparent py-1 pl-1.5 pr-7 text-sm font-medium outline-none transition enabled:hover:border-line enabled:focus:border-ink/30 enabled:focus:bg-surface"
                        aria-label="Field name"
                        title={canEdit ? "Rename" : undefined}
                      />
                      {canEdit && (
                        <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute right-2 size-3.5 text-muted opacity-0 transition group-hover/name:opacity-100 group-focus-within/name:opacity-0">
                          <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </label>
                    {f.builtin && <Pill>built-in</Pill>}
                    {f.required && <Pill tone="accent">required</Pill>}
                    {f.showInList && f.enabled && <Pill tone="info">in list</Pill>}
                    {canEdit && (
                      <div className="flex shrink-0 items-center">
                        <button type="button" onClick={() => setOpen(expanded ? null : f.key)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">
                          {expanded ? "Done" : "Edit"}
                        </button>
                        {f.builtin ? (
                          // Keeps the Edit buttons lined up; built-in fields can't be removed.
                          <span className="size-7" aria-hidden />
                        ) : (
                          <button
                            type="button"
                            onClick={() => remove(f)}
                            className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                            aria-label={`Remove ${f.label}`}
                            title="Remove field"
                          >
                            <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
                              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {expanded && (
                    <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        {!isName && <Toggle label="Collect this" checked={f.enabled} onChange={(v) => update(f.key, { enabled: v })} />}
                        {!isName && <Toggle label="Required" checked={f.required} onChange={(v) => update(f.key, { required: v })} />}
                        <Toggle label="Show in people list" checked={f.showInList} onChange={(v) => update(f.key, { showInList: v })} />
                      </div>
                      {(!f.builtin || f.key === "group_name") && (
                        <label className="flex items-center gap-2">
                          <span className="w-20 text-xs text-muted">Type</span>
                          <select
                            value={f.type}
                            onChange={(e) => {
                              const type = e.target.value as FieldType;
                              update(f.key, { type, ...(type === "select" && !f.options?.length ? { options: ["Option 1", "Option 2"] } : {}) });
                            }}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
                          >
                            {(f.key === "group_name" ? (["text", "select"] as FieldType[]) : FIELD_TYPES).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {f.type === "select" && <OptionsEditor options={f.options ?? []} onChange={(options) => update(f.key, { options })} />}
                      {f.type === "phone" && (
                        <DefaultCountry value={f.defaultCountry} onChange={(c) => update(f.key, { defaultCountry: c })} />
                      )}
                      <label className="flex items-center gap-2">
                        <span className="w-20 text-xs text-muted">Help text</span>
                        <Input value={f.help ?? ""} onChange={(e) => update(f.key, { help: e.target.value })} placeholder="Shown under the field" className="py-1" />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {canEdit && (
            <div className="mt-4 space-y-3">
              <div>
                <div className="mb-1.5 text-xs text-muted">Add a field</div>
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => add(t)}
                      className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs hover:border-ink/30"
                    >
                      <Icon name={t} className="size-3.5 text-muted" /> {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs text-muted">Or start from a template</div>
                <div className="flex flex-wrap gap-2">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/50 py-2 pl-2 pr-4 text-left text-xs hover:border-ink/30"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-ink/80 ring-1 ring-line">
                        <Icon name={t.icon} className="size-[18px]" />
                      </span>
                      <span>
                        <span className="block font-medium">{t.name}</span>
                        <span className="block text-muted">{t.fields.map((f) => f.label).slice(0, 3).join(", ")}…</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 text-xs text-muted">Preview</div>
          <div className="hatch rounded-2xl border border-line p-1">
            <div className="rounded-xl bg-surface p-4">
              <PersonFieldsForm fields={fields} values={preview} onChange={setPreview} />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition", checked ? "bg-good" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

function OptionsEditor({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [text, setText] = useState("");
  const addOpt = () => {
    const v = text.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setText("");
  };
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 pt-1 text-xs text-muted">Options</span>
      <div className="flex-1">
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <span key={o} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
              {o}
              <button type="button" onClick={() => onChange(options.filter((x) => x !== o))} className="text-muted hover:text-danger" aria-label={`Remove ${o}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addOpt();
            }
          }}
          onBlur={addOpt}
          placeholder="Type an option, press Enter"
          className="mt-1.5 w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none"
        />
      </div>
    </div>
  );
}

function DefaultCountry({ value, onChange }: { value?: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-2">
      <span className="w-20 text-xs text-muted">Country</span>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 text-sm">
        <span>{flag(value ?? "GH")}</span>
        {countryName(value ?? "GH")}
        <span className="text-[10px] text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute left-20 top-8">
          <CountryPicker
            current={(value ?? "GH") as CountryCode}
            onPick={(c) => {
              onChange(c);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
