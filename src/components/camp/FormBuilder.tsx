"use client";

import { useState } from "react";
import { Icon } from "@/components/FieldsEditor";
import { Card, cx, Input, Pill } from "@/components/ui";
import { eventDays } from "@/lib/camp/format";
import { FIELD_TYPES, newFieldKey, TYPE_LABELS, type FieldDef, type FieldType } from "@/lib/person-fields";
import RegistrationForm, { blankRegistration, effectiveForm, type AgeGroup, type RegistrationDraft, type FormConfig } from "./RegistrationForm";

/** Common camp questions, one click to add. */
const SUGGESTED: { label: string; type: FieldType; options?: string[] }[] = [
  { label: "Dietary needs", type: "text" },
  { label: "Medical conditions / allergies", type: "longtext" },
  { label: "Emergency contact", type: "phone" },
  { label: "T-shirt size", type: "select", options: ["XS", "S", "M", "L", "XL", "XXL", "Child"] },
  { label: "Role at camp", type: "select", options: ["Camper", "Usher", "Choir", "Kitchen", "Security", "Medical", "Pastor / elder"] },
  { label: "Baptized", type: "yesno" },
];

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-good" : "bg-line")}
    >
      <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

type Draft = {
  form: FormConfig;
  questions: FieldDef[];
  rooms: boolean;
  buses: boolean;
  churches: string[];
  unit: string;
  age_groups: AgeGroup[];
  child_age: number;
  starts_on: string;
  ends_on: string;
};

/**
 * The event's registration form: standard fields (switch on/off) and the
 * organizers' own fields (any type, rename, reorder, remove), with a live preview.
 */
export default function FormBuilder({ d, onForm, onQuestions }: { d: Draft; onForm: (f: FormConfig) => void; onQuestions: (q: FieldDef[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<RegistrationDraft>(blankRegistration);
  const eff = effectiveForm(d.form, d.rooms);
  const set = (p: Partial<FormConfig>) => onForm({ ...d.form, ...p });
  const qs = d.questions;
  const setQ = (key: string, p: Partial<FieldDef>) => onQuestions(qs.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[i], next[j]] = [next[j], next[i]];
    onQuestions(next);
  };
  const add = (type: FieldType, label = TYPE_LABELS[type], options?: string[]) => {
    const f: FieldDef = {
      key: newFieldKey(),
      label,
      type,
      enabled: true,
      required: false,
      showInList: false,
      ...(type === "select" ? { options: options ?? ["Option 1", "Option 2"] } : {}),
      ...(type === "phone" ? { defaultCountry: "GH" } : {}),
    };
    onQuestions([...qs, f]);
    if (!options && label === TYPE_LABELS[type]) setOpen(f.key); // new blank field: open it to name it
  };
  const days = eventDays(d.starts_on || null, d.ends_on || null);
  const unit = d.unit || "Church";

  return (
    <Card>
      <div className="mb-4">
        <h2 className="font-medium">Registration form</h2>
        <p className="text-xs text-muted">What each person is asked. Switch fields off, add your own, and see the form as people will.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,0.95fr)]">
        <div>
          <ul className="space-y-2">
            <Fixed icon="text" label="Full name" />
            <Fixed icon="select" label={unit} note="from your list" />
            <Fixed icon="phone" label="Contact phone" note="for SMS" />

            <Standard
              icon="select"
              label="Gender"
              on={eff.gender}
              locked={d.rooms ? "Needed for rooms" : undefined}
              onChange={(v) => set({ gender: v })}
            />
            <Standard
              icon="number"
              label="Age"
              on={eff.age !== "off"}
              locked={d.rooms ? "Needed for rooms" : undefined}
              onChange={(v) => set({ age: v ? "both" : "off" })}
            >
              {eff.age !== "off" && (
                <div className="flex flex-wrap gap-1 pl-10">
                  {(
                    [
                      ["both", "Age or range"],
                      ["exact", "Exact age"],
                      ["range", "Range only"],
                    ] as const
                  ).map(([m, l]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => set({ age: m })}
                      className={cx("rounded-full border px-2.5 py-0.5 text-xs", eff.age === m ? "border-ink bg-ink text-white" : "border-line text-muted hover:text-ink")}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </Standard>
            <Standard
              icon="date"
              label="Days attending"
              on={eff.days && days.length > 1}
              locked={days.length > 1 ? undefined : "Set event dates first"}
              note={d.buses ? "Only first-day arrivals get a bus seat" : undefined}
              onChange={(v) => set({ days: v })}
            />
            <Standard icon="email" label="Email" on={eff.email} onChange={(v) => set({ email: v })} />
            <Standard icon="phone" label="Phone for each adult" on={eff.member_phone} onChange={(v) => set({ member_phone: v })} />
            {d.buses && <Fixed icon="yesno" label="Needs a bus seat" note="because buses are on" />}

            {qs.map((q, i) => {
              const expanded = open === q.key;
              return (
                <li key={q.key} className="rounded-2xl border border-line bg-surface">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="flex flex-col">
                      <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="text-[10px] leading-none text-muted hover:text-ink disabled:opacity-20" aria-label="Move up">
                        ▲
                      </button>
                      <button type="button" disabled={i === qs.length - 1} onClick={() => move(i, 1)} className="text-[10px] leading-none text-muted hover:text-ink disabled:opacity-20" aria-label="Move down">
                        ▼
                      </button>
                    </div>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink/70" title={TYPE_LABELS[q.type]}>
                      <Icon name={q.type} className="size-3.5" />
                    </span>
                    <input
                      value={q.label}
                      maxLength={60}
                      onChange={(e) => setQ(q.key, { label: e.target.value })}
                      placeholder="Field name"
                      aria-label="Field name"
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-line focus:border-ink/30 focus:bg-surface"
                    />
                    {q.required && <Pill tone="accent">required</Pill>}
                    <button type="button" onClick={() => setOpen(expanded ? null : q.key)} className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink">
                      {expanded ? "Done" : "Edit"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onQuestions(qs.filter((x) => x.key !== q.key))}
                      className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`Remove ${q.label}`}
                      title="Remove field"
                    >
                      <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  {expanded && (
                    <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <label className="flex items-center gap-2 text-xs">
                          <Switch on={q.required} onChange={(v) => setQ(q.key, { required: v })} label="Required" />
                          Required
                        </label>
                        <label className="flex items-center gap-2 text-xs">
                          <span className="text-muted">Type</span>
                          <select
                            value={q.type}
                            onChange={(e) => {
                              const type = e.target.value as FieldType;
                              setQ(q.key, { type, ...(type === "select" && !q.options?.length ? { options: ["Option 1", "Option 2"] } : {}) });
                            }}
                            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {q.type === "select" && <Options options={q.options ?? []} onChange={(options) => setQ(q.key, { options })} />}
                      <label className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted">Help text</span>
                        <Input value={q.help ?? ""} onChange={(e) => setQ(q.key, { help: e.target.value })} placeholder="Shown under the field" className="flex-1 py-1" />
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

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
            {SUGGESTED.some((s) => !qs.some((q) => q.label.toLowerCase() === s.label.toLowerCase())) && (
              <div>
                <div className="mb-1.5 text-xs text-muted">Or a common one</div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED.filter((s) => !qs.some((q) => q.label.toLowerCase() === s.label.toLowerCase())).map((s) => (
                    <button key={s.label} type="button" onClick={() => add(s.type, s.label, s.options)} className="rounded-full border border-dashed border-line px-3 py-1 text-xs text-muted hover:border-ink/30 hover:text-ink">
                      + {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs text-muted">Preview</div>
          <div className="hatch rounded-2xl border border-line p-1">
            <div className="max-h-[44rem] overflow-y-auto rounded-xl bg-surface p-4">
              <RegistrationForm
                event={{
                  churches: d.churches.length ? d.churches : [`Your ${unit.toLowerCase()} list`],
                  child_age: d.child_age,
                  age_groups: d.age_groups,
                  questions: qs.filter((q) => q.label.trim()),
                  unit_label: unit,
                  days: eff.days ? days : [],
                  form: eff,
                  buses: d.buses,
                }}
                value={preview}
                onChange={setPreview}
              />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Fixed({ icon, label, note }: { icon: FieldType; label: string; note?: string }) {
  return (
    <li className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2/40 px-3 py-2">
      <span className="w-[13px]" />
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink/70">
        <Icon name={icon} className="size-3.5" />
      </span>
      <span className="flex-1 px-1.5 text-sm font-medium">{label}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
      <Pill>always</Pill>
    </li>
  );
}

function Standard({
  icon,
  label,
  on,
  onChange,
  locked,
  note,
  children,
}: {
  icon: FieldType;
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
  locked?: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <li className={cx("space-y-2 rounded-2xl border bg-surface px-3 py-2", on ? "border-line" : "border-dashed border-line/80")}>
      <div className="flex items-center gap-2">
        <span className="w-[13px]" />
        <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2", on ? "text-ink/70" : "text-muted/60")}>
          <Icon name={icon} className="size-3.5" />
        </span>
        <span className={cx("min-w-0 flex-1 px-1.5 text-sm font-medium", !on && "text-muted")}>
          {label}
          {(locked || note) && <span className="block text-xs font-normal text-muted">{locked ?? note}</span>}
        </span>
        <Switch on={on} onChange={onChange} disabled={!!locked} label={label} />
      </div>
      {children}
    </li>
  );
}

function Options({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [text, setText] = useState("");
  const addOpt = () => {
    const v = text.trim();
    if (v && !options.includes(v)) onChange([...options, v]);
    setText("");
  };
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 pt-1 text-xs text-muted">Options</span>
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
