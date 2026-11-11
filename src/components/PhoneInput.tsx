"use client";

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import examples from "libphonenumber-js/mobile/examples";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { countryName, DEFAULT_PHONE_COUNTRY } from "@/lib/person-fields";

export function flag(iso: string) {
  return /^[A-Z]{2}$/.test(iso) ? String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "🌐";
}

// When several countries share a calling code, which one a bare "+code" means.
const MAIN_FOR_CODE: Record<string, CountryCode> = {
  "1": "US", "7": "RU", "44": "GB", "47": "NO", "61": "AU", "39": "IT", "212": "MA", "262": "RE", "290": "SH", "358": "FI", "590": "GP", "599": "CW",
};
function countryForCallingCode(code: string, prefer?: string): CountryCode | undefined {
  if (prefer && getCountryCallingCode(prefer as CountryCode) === code) return prefer as CountryCode;
  return MAIN_FOR_CODE[code] ?? getCountries().find((c) => getCountryCallingCode(c) === code);
}

function browserCountry(): CountryCode | undefined {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && (getCountries() as string[]).includes(region) ? (region as CountryCode) : undefined;
  } catch {
    return undefined;
  }
}

const RECENT_KEY = "f2f_recent_countries";
function recentCountries(): CountryCode[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}
function rememberCountry(c: CountryCode) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...recentCountries().filter((x) => x !== c)].slice(0, 4)));
  } catch {}
}

type Country = { iso: CountryCode; name: string; code: string };
let ALL: Country[] | null = null;
function allCountries(): Country[] {
  ALL ??= getCountries()
    .map((iso) => ({ iso, name: countryName(iso), code: getCountryCallingCode(iso) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return ALL;
}

/**
 * International phone input. Emits E.164 (+233241234567) when the number is
 * valid; otherwise the best partial international form, so the server can say
 * precisely what's wrong.
 */
export default function PhoneInput({
  value,
  onChange,
  defaultCountry,
  invalid,
  id,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  defaultCountry?: string;
  invalid?: boolean;
  id?: string;
}) {
  const fallback = ((defaultCountry || DEFAULT_PHONE_COUNTRY) as CountryCode);
  const initial = useMemo(() => {
    const p = value ? parsePhoneNumberFromString(value, fallback) : undefined;
    return { country: (p?.country ?? fallback) as CountryCode, text: p ? p.formatNational() : (value ?? "") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [text, setText] = useState(initial.text);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = (t: string, c: CountryCode) => {
    if (!t.trim()) return onChange("");
    const ayt = new AsYouType(t.trim().startsWith("+") ? undefined : c);
    ayt.input(t);
    const n = ayt.getNumber();
    onChange(n ? n.number : t);
  };

  const onType = (raw: string) => {
    // Allow digits, spaces, dashes, brackets and a leading +.
    const cleaned = raw.replace(/[^\d+\s()-]/g, "");
    if (cleaned.trim().startsWith("+")) {
      // International input: detect the country from the code as they type.
      const ayt = new AsYouType();
      const formatted = ayt.input(cleaned);
      const cc = ayt.getCallingCode();
      const detected = ayt.getCountry() ?? (cc ? countryForCallingCode(cc, country) : undefined);
      if (detected && detected !== country) setCountry(detected);
      // Once the country is known, show it in national form next to the flag.
      const n = ayt.getNumber();
      if (detected && n && n.nationalNumber.length >= 4) {
        // Complete numbers: the country's own national style (UK "07911 123456").
        const nat = n.isValid() ? n.formatNational() : new AsYouType(detected).input(n.nationalNumber);
        setText(nat);
        onChange(n.number);
        return;
      }
      setText(formatted);
      return emit(cleaned, country);
    }
    // Deleting characters: don't reformat (it fights the cursor).
    const formatted = cleaned.length < text.length ? cleaned : new AsYouType(country).input(cleaned);
    setText(formatted);
    emit(formatted, country);
  };

  const pick = (c: CountryCode) => {
    setCountry(c);
    rememberCountry(c);
    setOpen(false);
    const digits = text.replace(/\D/g, "");
    const t = digits ? new AsYouType(c).input(digits) : "";
    setText(t);
    emit(t, c);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const parsed = text.trim() ? parsePhoneNumberFromString(text, country) : undefined;
  const valid = !!parsed?.isValid();
  const type = parsed?.getType();
  const example = useMemo(() => {
    try {
      return getExampleNumber(country, examples)?.formatNational() ?? "";
    } catch {
      return "";
    }
  }, [country]);

  return (
    <div className="relative">
      <div
        className={cx(
          "flex items-stretch overflow-hidden rounded-xl border bg-surface transition focus-within:ring-4 focus-within:ring-ink/5",
          invalid ? "border-danger/60" : "border-line focus-within:border-ink/40",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Country: ${countryName(country)}`}
          className="flex shrink-0 items-center gap-1.5 border-r border-line bg-surface-2/60 px-2.5 text-sm hover:bg-surface-2"
        >
          <span className="text-lg leading-none">{flag(country)}</span>
          <span className="font-mono text-xs text-ink/80">+{getCountryCallingCode(country)}</span>
          <span className="text-[10px] text-muted">▾</span>
        </button>
        <input
          ref={inputRef}
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={text}
          placeholder={example}
          onChange={(e) => onType(e.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm tracking-wide outline-none placeholder:text-muted/60"
        />
        {text.trim() && (
          <span className={cx("flex items-center pr-3 text-sm", valid ? "text-good" : "text-muted")} aria-hidden>
            {valid ? "✓" : "…"}
          </span>
        )}
      </div>
      {text.trim() && (
        <div className={cx("mt-1 text-xs", valid ? "text-good" : "text-muted")}>
          {valid ? (
            <>
              {parsed!.formatInternational()}
              {type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE" ? " · 📱 mobile" : type === "FIXED_LINE" ? " · ☎️ landline" : ""}
            </>
          ) : (
            `Keep typing — ${countryName(country)} numbers look like ${example || "…"}`
          )}
        </div>
      )}
      {open && <CountryPicker current={country} preferred={defaultCountry as CountryCode | undefined} onPick={pick} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function CountryPicker({
  current,
  preferred,
  onPick,
  onClose,
}: {
  current: CountryCode;
  preferred?: CountryCode;
  onPick: (c: CountryCode) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  const items = useMemo(() => {
    const all = allCountries();
    const term = q.trim().toLowerCase().replace(/^\+/, "");
    if (term) {
      return all
        .filter((c) => c.name.toLowerCase().includes(term) || c.iso.toLowerCase() === term || c.code.startsWith(term))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(term)) - Number(a.name.toLowerCase().startsWith(term)));
    }
    const top = [...new Set([preferred, browserCountry(), ...recentCountries()].filter(Boolean) as CountryCode[])];
    const suggested = top.map((iso) => all.find((c) => c.iso === iso)!).filter(Boolean);
    return [...suggested.map((c) => ({ ...c, suggested: true })), ...all];
  }, [q, preferred]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div ref={ref} className="card-shadow absolute left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-2xl border border-line bg-surface">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && items[active]) {
            e.preventDefault();
            onPick(items[active].iso);
          } else if (e.key === "Escape") onClose();
        }}
        placeholder="Search country or +code"
        className="w-full border-b border-line bg-transparent px-3.5 py-2.5 text-sm outline-none"
      />
      <ul ref={listRef} role="listbox" className="max-h-64 overflow-auto py-1">
        {items.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">No match</li>}
        {items.map((c, i) => {
          const firstAll = !q && i === items.findIndex((x) => !("suggested" in x));
          return (
            <li key={`${c.iso}-${i}`}>
              {firstAll && i > 0 && <div className="mx-3 my-1 h-px bg-line" />}
              <button
                type="button"
                data-i={i}
                role="option"
                aria-selected={c.iso === current}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(c.iso)}
                className={cx("flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-sm", i === active && "bg-surface-2")}
              >
                <span className="text-base leading-none">{flag(c.iso)}</span>
                <span className="flex-1 truncate">{c.name}</span>
                <span className="font-mono text-xs text-muted">+{c.code}</span>
                {c.iso === current && <span className="text-good">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A stored phone number, formatted with its flag, plus call / WhatsApp / copy. */
export function PhoneDisplay({ value, compact }: { value: string | null | undefined; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  const p = parsePhoneNumberFromString(value);
  if (!p) return <span className="font-mono text-xs">{value}</span>;
  const digits = p.number.replace("+", "");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-sm leading-none" title={p.country ? countryName(p.country) : undefined}>
        {flag(p.country ?? "")}
      </span>
      <a href={`tel:${p.number}`} className="font-mono text-xs tracking-wide hover:underline" onClick={(e) => e.stopPropagation()}>
        {p.formatInternational()}
      </a>
      {!compact && (
        <span className="ml-1 inline-flex gap-1">
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Message on WhatsApp"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md bg-good-soft/70 px-1.5 py-0.5 text-[10px] font-medium text-good hover:bg-good-soft"
          >
            WhatsApp
          </a>
          <button
            type="button"
            title="Copy"
            onClick={async (e) => {
              e.stopPropagation();
              await navigator.clipboard.writeText(p.number);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted hover:text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      )}
    </span>
  );
}
