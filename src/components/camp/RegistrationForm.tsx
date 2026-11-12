"use client";

import { useState } from "react";
import { PersonFieldsForm } from "@/components/PersonFields";
import PhoneInput from "@/components/PhoneInput";
import { Button, cx, Field, Group, Input, Pill } from "@/components/ui";
import type { FieldDef } from "@/lib/person-fields";

export type AgeGroup = { name: string; upTo: number };
export type EventInfo = {
  churches: string[];
  child_age: number;
  age_groups: AgeGroup[];
  questions: FieldDef[];
  unit_label: string;
  days: string[]; // every day of the event; [] when no dates are set or days aren't asked
  form: FormConfig;
  buses: boolean; // does this event allocate bus seats?
};

/** What the form asks (the event's Setup → Registration form). */
export type FormConfig = {
  gender: boolean;
  age: "both" | "range" | "exact" | "off";
  days: boolean;
  email: boolean;
  member_phone: boolean;
};
export const DEFAULT_FORM: FormConfig = {
  gender: true,
  age: "both",
  days: true,
  email: true,
  member_phone: true,
};
/** Same rule as the server: rooms need gender and some idea of age. */
export function effectiveForm(
  form: Partial<FormConfig> | null | undefined,
  rooms: boolean,
): FormConfig {
  const f = { ...DEFAULT_FORM, ...(form ?? {}) };
  if (rooms) {
    f.gender = true;
    if (f.age === "off") f.age = "range";
  }
  return f;
}

export type MemberDraft = {
  id?: string;
  full_name: string;
  gender: "" | "male" | "female";
  age: string; // exact age, or…
  age_group: string; // …an age range (one of the event's groups)
  days: string[] | null; // null = same days as everyone else in this registration
  relation: string;
  phone: string;
  needs_bus: boolean;
  answers: Record<string, unknown>;
};
export type RegistrationDraft = {
  church: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  days: string[] | null; // null = every day
  members: MemberDraft[];
};

const RELATION_LABEL: Record<string, string> = {
  self: "Me · contact person",
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Brother / sister",
  relative: "Relative",
  other: "Other",
};

export const blankMember = (
  relation = "self",
  needs_bus = false,
): MemberDraft => ({
  full_name: "",
  gender: "",
  age: "",
  age_group: "",
  days: null,
  relation,
  phone: "",
  needs_bus,
  answers: {},
});
export const blankRegistration = (): RegistrationDraft => ({
  church: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  days: null,
  members: [blankMember()],
});

export function ageGroupName(age: number | null, groups: AgeGroup[]) {
  if (age === null) return null;
  return groups.find((g) => age <= g.upTo)?.name ?? null;
}

/** "Children · 0–9", "Seniors · 60+" */
export function rangeLabel(groups: AgeGroup[], i: number) {
  const lo = i === 0 ? 0 : groups[i - 1].upTo + 1;
  const hi = groups[i].upTo;
  return hi >= 120 ? `${lo}+` : `${lo}–${hi}`;
}

const dayLabel = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return {
    wd: t.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    n: t.getUTCDate(),
  };
};

/** A person's days: their own, else the family's, else every day. */
const daysOf = (m: MemberDraft, f: RegistrationDraft, all: string[]) =>
  m.days ?? f.days ?? all;

/** What the API expects. */
export function toPayload(
  f: RegistrationDraft,
  all: string[] = [],
  form: FormConfig = DEFAULT_FORM,
  buses = true,
) {
  return {
    church: f.church,
    contact_name: f.members[0]?.full_name ?? "", // person 1 is the contact
    contact_phone: f.contact_phone,
    contact_email: form.email ? f.contact_email : "",
    members: f.members.map((m) => {
      const days = all.length ? daysOf(m, f, all) : null;
      return {
        id: m.id,
        full_name: m.full_name,
        gender: form.gender ? m.gender || undefined : null,
        age:
          m.age === "" || form.age === "off" || form.age === "range"
            ? null
            : Number(m.age),
        age_group:
          (m.age === "" || form.age === "range") &&
          form.age !== "off" &&
          form.age !== "exact"
            ? m.age_group || null
            : null,
        days,
        relation: m.relation || null,
        phone: m.phone || null,
        // The bus is for the first day only.
        needs_bus:
          buses && m.needs_bus && (!all.length || !!days?.includes(all[0])),
        answers: m.answers,
      };
    }),
  };
}

/** Problems the server would reject, caught before submitting. */
export function checkRegistration(
  f: RegistrationDraft,
  all: string[],
  form: FormConfig = DEFAULT_FORM,
) {
  for (const [i, m] of f.members.entries()) {
    const who = m.full_name || `person ${i + 1}`;
    if (form.gender && !m.gender) return `Choose male or female for ${who}`;
    if (form.age === "exact" && m.age === "") return `Give ${who}'s age`;
    if (form.age === "range" && !m.age_group)
      return `Choose an age range for ${who}`;
    if (form.age === "both" && m.age === "" && !m.age_group)
      return `Give an age or choose an age range for ${who}`;
    if (all.length && !daysOf(m, f, all).length)
      return `Choose at least one day for ${who}`;
  }
  return null;
}

/**
 * One registration: the contact person, their church, and everyone coming with
 * them. Used by the public registration page and by admins (phone-ins, edits).
 */
export default function RegistrationForm({
  event,
  value,
  onChange,
}: {
  event: EventInfo;
  value: RegistrationDraft;
  onChange: (v: RegistrationDraft) => void;
}) {
  const form = event.form;
  const all = event.days;
  const first = event.buses ? all[0] : undefined;
  const set = (patch: Partial<RegistrationDraft>) => onChange({ ...value, ...patch });
  const setMember = (i: number, patch: Partial<MemberDraft>) =>
    set({
      members: value.members.map((m, j) => (j === i ? { ...m, ...patch } : m)),
    });
  const busAll =
    value.members.length > 0 && value.members.every((m) => m.needs_bus);
  const add = (relation: string) =>
    set({ members: [...value.members, blankMember(relation, busAll)] });
  const isChild = (m: MemberDraft) => {
    if (form.age === "off") return false;
    const age =
      m.age !== "" && form.age !== "range"
        ? Number(m.age)
        : event.age_groups.find((g) => g.name === m.age_group)?.upTo;
    return age !== undefined && age <= event.child_age;
  };
  const kids = value.members.filter(isChild).length;
  const [perPerson, setPerPerson] = useState(value.members.some((m) => m.days));
  const unit = event.unit_label || "Church";

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2">
        <Field label={unit}>
          <select
            required
            value={value.church}
            onChange={(e) => set({ church: e.target.value })}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="">Choose your {unit.toLowerCase()}…</option>
            {event.churches.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Phone (for SMS)">
          <PhoneInput
            value={value.contact_phone}
            onChange={(v) => set({ contact_phone: v })}
            defaultCountry="GH"
          />
        </Field>
        {form.email && (
          <Field label="Email (optional)">
            <Input
              type="email"
              autoComplete="email"
              value={value.contact_email}
              onChange={(e) => set({ contact_email: e.target.value })}
            />
          </Field>
        )}
      </section>

      {all.length > 1 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Days you&apos;re attending</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={perPerson}
                onChange={(e) => {
                  setPerPerson(e.target.checked);
                  if (!e.target.checked)
                    set({
                      members: value.members.map((m) => ({ ...m, days: null })),
                    });
                }}
                className="size-4 accent-[var(--ink)]"
              />
              Different days for someone
            </label>
          </div>
          <DayPicker
            all={all}
            days={value.days ?? all}
            bus={event.buses}
            onChange={(days) =>
              set({ days: days.length === all.length ? null : days })
            }
          />
          {first && !(value.days ?? all).includes(first) && !perPerson && (
            <p className="text-xs text-muted">
              Buses only run on the first day, so you&apos;ll arrange your own
              transport.
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Who&apos;s coming{" "}
            <span className="font-normal text-muted">
              · {value.members.length}{" "}
              {value.members.length === 1 ? "person" : "people"}
              {kids ? `, ${kids} ${kids === 1 ? "child" : "children"}` : ""}
            </span>
          </h3>
          {event.buses && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={busAll}
                onChange={(e) =>
                  set({
                    members: value.members.map((m) => ({
                      ...m,
                      needs_bus: e.target.checked,
                    })),
                  })
                }
                className="size-4 accent-[var(--ink)]"
              />
              Everyone needs the bus
            </label>
          )}
        </div>

        {value.members.map((m, i) => {
          const age = m.age === "" ? null : Number(m.age);
          const group =
            m.age === "" || form.age === "range"
              ? m.age_group || null
              : ageGroupName(age, event.age_groups);
          const child = isChild(m);
          const days = daysOf(m, value, all);
          const busOk = !first || days.includes(first);
          return (
            <div
              key={i}
              className="rounded-2xl border border-line bg-surface p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-full bg-surface-2 text-xs font-medium">
                  {i + 1}
                </span>
                {i === 0 ? (
                  <span className="text-xs text-muted">
                    {RELATION_LABEL.self}
                  </span>
                ) : (
                  <select
                    value={m.relation}
                    onChange={(e) => setMember(i, { relation: e.target.value })}
                    className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                  >
                    {Object.entries(RELATION_LABEL)
                      .filter(([k]) => k !== "self")
                      .map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                  </select>
                )}
                {child && value.members.length > 1 && (
                  <Pill tone="good">Stays with a parent</Pill>
                )}
                {value.members.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      set({ members: value.members.filter((_, j) => j !== i) })
                    }
                    className="ml-auto flex size-7 items-center justify-center rounded-lg text-muted hover:bg-danger/10 hover:text-danger"
                    aria-label={`Remove person ${i + 1}`}
                  >
                    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
              </div>

              <div
                className={cx(
                  "grid gap-3",
                  form.gender && "sm:grid-cols-[1fr_auto]",
                )}
              >
                <Field label="Full name">
                  <Input
                    required
                    value={m.full_name}
                    onChange={(e) => {
                      setMember(i, { full_name: e.target.value });
                    }}
                  />
                </Field>
                {form.gender && (
                  <Group label="Gender">
                    <div className="flex rounded-xl border border-line bg-surface p-1 text-sm">
                      {(["female", "male"] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          aria-pressed={m.gender === g}
                          onClick={() => setMember(i, { gender: g })}
                          className={cx(
                            "rounded-lg px-3 py-1",
                            m.gender === g
                              ? "bg-ink text-white"
                              : "text-muted hover:text-ink",
                          )}
                        >
                          {g === "female" ? "Female" : "Male"}
                        </button>
                      ))}
                    </div>
                  </Group>
                )}
              </div>

              {/* Age: tap a range, or type the exact age (which picks the range for you). */}
              {form.age !== "off" && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-muted">Age</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {form.age !== "exact" &&
                      event.age_groups.map((g, gi) => (
                        <button
                          key={g.name}
                          type="button"
                          aria-pressed={group === g.name}
                          onClick={() =>
                            setMember(i, { age_group: g.name, age: "" })
                          }
                          className={cx(
                            "rounded-full border px-3 py-1 text-xs transition",
                            group === g.name
                              ? "border-ink bg-ink text-white"
                              : "border-line text-muted hover:border-ink/30 hover:text-ink",
                          )}
                        >
                          {g.name}{" "}
                          <span
                            className={
                              group === g.name
                                ? "text-white/70"
                                : "text-muted/80"
                            }
                          >
                            {rangeLabel(event.age_groups, gi)}
                          </span>
                        </button>
                      ))}
                    {form.age === "both" && (
                      <span className="mx-1 text-xs text-muted">or</span>
                    )}
                    {form.age !== "range" && (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={120}
                        value={m.age}
                        onChange={(e) =>
                          setMember(i, { age: e.target.value, age_group: "" })
                        }
                        placeholder="Exact age"
                        aria-label="Exact age"
                        className="w-24 rounded-full border border-line bg-surface px-3 py-1 text-xs outline-none focus:border-ink/30"
                      />
                    )}
                  </div>
                </div>
              )}

              {perPerson && all.length > 1 && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-xs font-medium text-muted">Days</div>
                  <DayPicker
                    all={all}
                    days={days}
                    onChange={(d) => setMember(i, { days: d })}
                    small
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {event.buses && (
                  <label
                    className={cx(
                      "flex items-center gap-2 text-xs",
                      busOk ? "cursor-pointer" : "text-muted",
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={!busOk}
                      checked={m.needs_bus && busOk}
                      onChange={(e) =>
                        setMember(i, { needs_bus: e.target.checked })
                      }
                      className="size-4 accent-[var(--ink)]"
                    />
                    {busOk ? "Needs a bus seat" : "Bus: first day only"}
                  </label>
                )}
                {i > 0 && !child && form.member_phone && (
                  <div className="min-w-48 flex-1">
                    <PhoneInput
                      value={m.phone}
                      onChange={(v) => setMember(i, { phone: v })}
                      defaultCountry="GH"
                    />
                  </div>
                )}
              </div>

              {event.questions.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <PersonFieldsForm
                    fields={event.questions}
                    values={m.answers}
                    onChange={(answers) => setMember(i, { answers })}
                  />
                </div>
              )}
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          {!value.members.some((m) => m.relation === "spouse") && (
            <Button type="button" variant="ghost" onClick={() => add("spouse")}>
              + Spouse
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => add("child")}>
            + Child
          </Button>
          <Button type="button" variant="ghost" onClick={() => add("relative")}>
            + Someone else
          </Button>
        </div>
      </section>
    </div>
  );
}

function DayPicker({
  all,
  days,
  onChange,
  small,
  bus,
}: {
  all: string[];
  days: string[];
  onChange: (d: string[]) => void;
  small?: boolean;
  bus?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((d, i) => {
        const on = days.includes(d);
        const { wd, n } = dayLabel(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? days.filter((x) => x !== d) : [...days, d].sort())
            }
            className={cx(
              "flex flex-col items-center rounded-xl border leading-tight transition",
              small ? "w-11 py-1" : "w-14 py-1.5",
              on
                ? "border-ink bg-ink text-white"
                : "border-line text-muted hover:border-ink/30",
            )}
          >
            <span className="text-[10px] uppercase tracking-wide opacity-80">
              {wd}
            </span>
            <span
              className={cx(
                "font-semibold tabular-nums",
                small ? "text-sm" : "text-base",
              )}
            >
              {n}
            </span>
            {i === 0 && !small && bus && (
              <span className="text-[9px] opacity-70">bus</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
