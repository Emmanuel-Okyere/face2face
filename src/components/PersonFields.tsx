"use client";

import PhoneInput, { PhoneDisplay } from "@/components/PhoneInput";
import { cx, Input, Pill } from "@/components/ui";
import { displayValue, enabledFields, type FieldDef } from "@/lib/person-fields";

export type FormValues = Record<string, unknown>;

/** Flat form values for a person: built-in columns + custom attributes. */
export function personToForm(p: Record<string, unknown> & { attributes?: Record<string, unknown> | null }): FormValues {
  const { attributes, ...rest } = p;
  return { ...rest, ...(attributes ?? {}) };
}

const selectCls = "w-full rounded-xl border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5";

/** Renders the organization's own person fields, in its chosen order. */
export function PersonFieldsForm({
  fields,
  values,
  onChange,
  errors = {},
  autoFocus,
}: {
  fields: FieldDef[];
  values: FormValues;
  onChange: (v: FormValues) => void;
  errors?: Record<string, string>;
  autoFocus?: boolean;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {enabledFields(fields).map((f, i) => {
        const err = errors[f.key];
        const v = values[f.key];
        const id = `f-${f.key}`;
        const wide = f.type === "longtext" || f.key === "full_name";
        return (
          <div key={f.key} className={cx("space-y-1.5", wide && "sm:col-span-2")}>
            <label htmlFor={id} className="flex items-baseline justify-between text-xs font-medium text-muted">
              <span>
                {f.label}
                {f.required ? <span className="text-accent"> *</span> : <span className="font-normal"> (optional)</span>}
              </span>
            </label>
            {f.type === "phone" ? (
              <PhoneInput id={id} value={(v as string) ?? ""} onChange={(x) => set(f.key, x)} defaultCountry={f.defaultCountry} invalid={!!err} />
            ) : f.type === "longtext" ? (
              <textarea
                id={id}
                rows={3}
                value={(v as string) ?? ""}
                onChange={(e) => set(f.key, e.target.value)}
                className={cx(selectCls, err ? "border-danger/60" : "border-line")}
              />
            ) : f.type === "select" ? (
              <select id={id} value={(v as string) ?? ""} onChange={(e) => set(f.key, e.target.value)} className={cx(selectCls, err ? "border-danger/60" : "border-line")}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "yesno" ? (
              <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm" role="radiogroup" aria-labelledby={id}>
                {[
                  [true, "Yes"],
                  [false, "No"],
                  [null, "—"],
                ].map(([val, l]) => (
                  <button
                    type="button"
                    key={String(l)}
                    role="radio"
                    aria-checked={v === val || (val === null && (v === undefined || v === ""))}
                    onClick={() => set(f.key, val)}
                    className={cx(
                      "rounded-full px-4 py-1 transition",
                      v === val || (val === null && (v === undefined || v === "" || v === null)) ? "bg-ink text-white" : "text-muted hover:text-ink",
                    )}
                  >
                    {l as string}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                id={id}
                autoFocus={autoFocus && i === 0}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                inputMode={f.type === "number" ? "decimal" : undefined}
                value={v === null || v === undefined ? "" : String(v)}
                onChange={(e) => set(f.key, e.target.value)}
                className={err ? "border-danger/60" : undefined}
                maxLength={f.type === "text" ? 200 : undefined}
              />
            )}
            {err ? <p className="text-xs text-danger">{err}</p> : f.help ? <p className="text-xs text-muted">{f.help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Read-only value for lists and the profile. */
export function FieldValue({ field, value, compact }: { field: FieldDef; value: unknown; compact?: boolean }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">—</span>;
  if (field.type === "phone") return <PhoneDisplay value={String(value)} compact={compact} />;
  if (field.type === "email")
    return (
      <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
        {String(value)}
      </a>
    );
  if (field.type === "yesno") return <Pill tone={value ? "good" : "muted"}>{value ? "Yes" : "No"}</Pill>;
  if (field.type === "select" || field.key === "group_name") return <Pill>{String(value)}</Pill>;
  return <span className={field.type === "longtext" ? "whitespace-pre-line" : undefined}>{displayValue(field, value)}</span>;
}

/** Value of a field for a person row from the API (built-in column or custom attribute). */
export function valueOf(field: FieldDef, person: Record<string, unknown> & { attributes?: Record<string, unknown> | null }) {
  return field.builtin ? person[field.key] : person.attributes?.[field.key];
}
