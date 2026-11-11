// Per-organization person fields — shared by the browser forms and the server,
// so validation is identical on both sides (the server is the authority).
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export const FIELD_TYPES = ["text", "longtext", "number", "date", "select", "yesno", "phone", "email"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const TYPE_LABELS: Record<FieldType, string> = {
  text: "Short text",
  longtext: "Paragraph",
  number: "Number",
  date: "Date",
  select: "Dropdown",
  yesno: "Yes / No",
  phone: "Phone number",
  email: "Email",
};

export type FieldDef = {
  key: string; // built-ins: full_name, code, group_name, email, phone · custom: c_xxxxxx (stable across renames)
  label: string;
  type: FieldType;
  builtin?: boolean;
  enabled: boolean;
  required: boolean;
  showInList: boolean;
  options?: string[]; // select (and optionally the built-in group)
  defaultCountry?: string; // phone: ISO 3166 alpha-2, e.g. "GH"
  help?: string;
};

/** Phone numbers typed without a +code are read as Ghanaian unless a field says otherwise. */
export const DEFAULT_PHONE_COUNTRY = "GH";

export const BUILTIN_KEYS = ["full_name", "code", "group_name", "email", "phone"] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export const DEFAULT_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Full name", type: "text", builtin: true, enabled: true, required: true, showInList: true },
  { key: "code", label: "ID code", type: "text", builtin: true, enabled: true, required: false, showInList: true, help: "Staff / student / member number" },
  { key: "group_name", label: "Group", type: "text", builtin: true, enabled: true, required: false, showInList: true, help: "Department, class, ministry…" },
  { key: "email", label: "Email", type: "email", builtin: true, enabled: true, required: false, showInList: false },
  { key: "phone", label: "Phone", type: "phone", builtin: true, enabled: true, required: false, showInList: false, defaultCountry: DEFAULT_PHONE_COUNTRY },
];

/** The org's fields: stored definitions merged over defaults (built-ins always present, in stored order). */
export function resolveFields(stored: unknown): FieldDef[] {
  const list = Array.isArray(stored) ? (stored as FieldDef[]) : [];
  const byKey = new Map(list.map((f) => [f.key, f]));
  const out: FieldDef[] = [];
  for (const f of list) {
    const def = DEFAULT_FIELDS.find((d) => d.key === f.key);
    out.push(def ? { ...def, ...f, builtin: true, key: def.key, type: builtinType(def, f) } : { ...f, builtin: false });
  }
  for (const d of DEFAULT_FIELDS) if (!byKey.has(d.key)) out.splice(DEFAULT_FIELDS.indexOf(d), 0, { ...d });
  // Name is always on and required; phone fields without a country default to Ghana.
  return out.map((f) =>
    f.key === "full_name"
      ? { ...f, enabled: true, required: true }
      : f.type === "phone" && !f.defaultCountry
        ? { ...f, defaultCountry: DEFAULT_PHONE_COUNTRY }
        : f,
  );
}

// Built-ins keep their type, except group which may be free text or a dropdown.
function builtinType(def: FieldDef, f: FieldDef): FieldType {
  return def.key === "group_name" && (f.type === "select" || f.type === "text") ? f.type : def.type;
}

export const enabledFields = (fields: FieldDef[]) => fields.filter((f) => f.enabled);

export type PersonValues = {
  full_name?: string;
  code?: string | null;
  group_name?: string | null;
  email?: string | null;
  phone?: string | null;
  attributes?: Record<string, unknown>;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize a phone number to E.164, or null if it isn't a valid number. */
export function toE164(raw: string, defaultCountry?: string): string | null {
  const p = parsePhoneNumberFromString(raw, (defaultCountry || DEFAULT_PHONE_COUNTRY) as CountryCode);
  return p && p.isValid() ? p.number : null;
}

export function countryName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Validate one field's raw input. Returns [value, error]. Empty → null. */
export function coerce(f: FieldDef, raw: unknown): [unknown, string | null] {
  const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
  if (empty) return [null, f.required ? `${f.label} is required` : null];
  const s = typeof raw === "string" ? raw.trim() : raw;
  switch (f.type) {
    case "text":
      return typeof s === "string" && s.length <= 200 ? [s, null] : [null, `${f.label}: up to 200 characters`];
    case "longtext":
      return typeof s === "string" && s.length <= 2000 ? [s, null] : [null, `${f.label}: up to 2000 characters`];
    case "email":
      return typeof s === "string" && EMAIL.test(s) && s.length <= 200 ? [s.toLowerCase(), null] : [null, `${f.label}: not a valid email`];
    case "number": {
      const n = typeof s === "number" ? s : Number(String(s).replace(/,/g, ""));
      return Number.isFinite(n) ? [n, null] : [null, `${f.label}: not a number`];
    }
    case "date":
      return typeof s === "string" && DATE.test(s) && !Number.isNaN(Date.parse(s)) ? [s, null] : [null, `${f.label}: use YYYY-MM-DD`];
    case "yesno": {
      if (typeof s === "boolean") return [s, null];
      const v = String(s).toLowerCase();
      if (["yes", "y", "true", "1"].includes(v)) return [true, null];
      if (["no", "n", "false", "0"].includes(v)) return [false, null];
      return [null, `${f.label}: answer yes or no`];
    }
    case "select": {
      const opts = f.options ?? [];
      const hit = opts.find((o) => o.toLowerCase() === String(s).toLowerCase());
      return hit ? [hit, null] : [null, `${f.label}: choose one of ${opts.slice(0, 6).join(", ")}${opts.length > 6 ? "…" : ""}`];
    }
    case "phone": {
      const e164 = toE164(String(s), f.defaultCountry);
      const where = f.defaultCountry ? ` (${countryName(f.defaultCountry)} numbers can skip the +code)` : "";
      return e164 ? [e164, null] : [null, `${f.label}: not a valid phone number${where}`];
    }
  }
}

/**
 * Validate a person against the org's fields. `partial` (edits) only checks keys
 * present in `input`. Disabled fields are ignored. Unknown keys are dropped.
 */
export function validatePerson(
  fields: FieldDef[],
  input: Record<string, unknown>,
  opts: { partial?: boolean } = {},
): { values: PersonValues; errors: Record<string, string> } {
  const values: PersonValues = {};
  const attributes: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const src = (input.attributes && typeof input.attributes === "object" ? { ...input, ...(input.attributes as object) } : input) as Record<string, unknown>;
  for (const f of enabledFields(fields)) {
    if (opts.partial && !(f.key in src)) continue;
    const [v, err] = coerce(f, src[f.key]);
    if (err) {
      errors[f.key] = err;
      continue;
    }
    if (f.builtin) (values as Record<string, unknown>)[f.key] = v;
    else attributes[f.key] = v;
  }
  if (Object.keys(attributes).length || !opts.partial) values.attributes = attributes;
  return { values, errors };
}

/** Validate field definitions sent by an organization owner. */
export function checkFieldDefs(list: FieldDef[]): string | null {
  if (list.length > 40) return "At most 40 fields";
  const keys = new Set<string>();
  for (const f of list) {
    if (keys.has(f.key)) return `Duplicate field ${f.key}`;
    keys.add(f.key);
    const builtin = (BUILTIN_KEYS as readonly string[]).includes(f.key);
    if (!builtin && !/^c_[a-z0-9]{4,12}$/.test(f.key)) return `Invalid field key ${f.key}`;
    if (!FIELD_TYPES.includes(f.type)) return `Invalid type for ${f.label}`;
    if (!f.label?.trim() || f.label.length > 60) return "Every field needs a label (max 60 characters)";
    if (f.type === "select" && (!f.options?.length || f.options.some((o) => !o.trim() || o.length > 80) || f.options.length > 100))
      return `${f.label}: dropdowns need 1–100 options`;
    if (f.defaultCountry && !/^[A-Z]{2}$/.test(f.defaultCountry)) return `${f.label}: invalid country`;
    if (f.help && f.help.length > 160) return `${f.label}: help text too long`;
  }
  return null;
}

/** Human display for a stored value. */
export function displayValue(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (f.type === "yesno") return v ? "Yes" : "No";
  if (f.type === "date") return new Date(`${v}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  if (f.type === "phone") return parsePhoneNumberFromString(String(v))?.formatInternational() ?? String(v);
  return String(v);
}

export function newFieldKey() {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "c_";
  const r = crypto.getRandomValues(new Uint8Array(6));
  for (const b of r) s += a[b % a.length];
  return s;
}
