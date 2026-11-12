"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "good" | "ghost" | "danger" | "subtle";
export function Button({
  variant = "primary",
  className,
  loading,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
        "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        variant === "primary" && "bg-ink text-white hover:bg-ink/85",
        variant === "good" && "bg-good text-white hover:bg-good/90",
        variant === "ghost" && "border border-line bg-surface text-ink hover:bg-surface-2",
        variant === "subtle" && "text-muted hover:text-ink hover:bg-surface-2",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger/10",
        className,
      )}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        // Full width unless the caller sizes it (w-20, flex-1, …) — otherwise both classes fight.
        !/(^|\s)(w-|flex-1|basis-)/.test(className ?? "") && "w-full",
        "rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-muted/80",
        "focus:outline-none focus:border-ink/40 focus:ring-4 focus:ring-ink/5",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Like Field, for groups of buttons (a <label> would forward clicks to the first button). */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <span className="block text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}

/** A "⋯" button with a few less-used actions (archive, delete…). */
export function MoreMenu({ items, label = "More actions" }: { items: { label: string; onClick: () => void; danger?: boolean }[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
      >
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="card-shadow absolute right-0 z-30 mt-1 min-w-36 rounded-xl border border-line bg-surface p-1 text-sm">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx("block w-full rounded-lg px-3 py-1.5 text-left", it.danger ? "text-danger hover:bg-danger/5" : "hover:bg-surface-2")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A number that counts up to its value on first show, then glides to new values
 * (e.g. on the dashboard's live refresh). Plain text for reduced-motion users.
 */
export function CountUp({ value, format = String, duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    if (reduce || start === value) {
      from.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const t0 = performance.now();
    let id = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = Math.round(start + (value - start) * eased);
      setShown(v);
      from.current = v;
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [value, duration]);
  return <span aria-label={format(value)}>{format(shown)}</span>;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card-shadow rounded-2xl border border-line/70 bg-surface p-5", className)}>{children}</div>;
}

/** Status colour for text: darker than the fill colours so it reads on the page without a background. */
export const STATUS_TEXT = {
  accent: "text-[#c4441a]",
  good: "text-[#2e7d4f]",
  warn: "text-[#9a5f0c]",
  danger: "text-[#c23b31]",
  info: "text-[#4458b8]",
} as const;
const STATUS_BG = {
  accent: "bg-accent/[0.09]",
  good: "bg-good/[0.11]",
  warn: "bg-warn/[0.13]",
  danger: "bg-danger/[0.09]",
  info: "bg-info/[0.13]",
} as const;

/**
 * A small label, all one shape: slightly rounded, no outline. The default is a
 * quiet grey tag for plain facts ("Everyone", "built-in"); a tone adds a light
 * tint and darker text for a status ("Open now", "Late after 09:00").
 */
export function Pill({ tone = "muted", children }: { tone?: "accent" | "good" | "warn" | "danger" | "info" | "muted"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-px text-[11px] leading-[18px]",
        tone === "muted" ? "bg-surface-2 text-ink/65" : cx("font-medium", STATUS_BG[tone], STATUS_TEXT[tone]),
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Avatar({ src, name, size = 36 }: { src?: string | null; name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-2 ring-surface" style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-info-soft text-xs font-semibold text-ink/70 ring-2 ring-surface"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-lg font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
        <circle cx="16" cy="16" r="14.5" fill="var(--accent)" />
        <path d="M9.5 12.5V9.5h3M22.5 12.5V9.5h-3M9.5 19.5v3h3M22.5 19.5v3h-3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="13.5" cy="15" r="1.4" fill="#fff" />
        <circle cx="18.5" cy="15" r="1.4" fill="#fff" />
        <path d="M13.2 18.6c1.6 1.3 4 1.3 5.6 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
      Face2Face
    </span>
  );
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, shared by every request that hit an expired access token. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }, retried = false): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && !retried && !url.startsWith("/api/auth/login") && !url.startsWith("/api/kiosk")) {
    if (await refreshSession()) return api<T>(url, init, true);
    if (typeof window !== "undefined" && url.startsWith("/api/admin")) {
      // Full reload on purpose: drops all in-memory state of the expired session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    }
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === "password_change_required" && typeof window !== "undefined") {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/change-password";
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data as T;
}

export function timeAgo(iso: string | Date) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtTime(iso: string | Date) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Full page load instead of client navigation. Used after switching
 * organization so nothing from the previous tenant survives in memory.
 */
export function hardNavigate(path: string) {
  window.location.assign(path);
}

/** The default mark (used when an organization hasn't uploaded a logo). */
export function DefaultMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <circle cx="16" cy="16" r="14.5" fill="var(--accent)" />
      <path d="M9.5 12.5V9.5h3M22.5 12.5V9.5h-3M9.5 19.5v3h3M22.5 19.5v3h-3" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="13.5" cy="15" r="1.4" fill="#fff" />
      <circle cx="18.5" cy="15" r="1.4" fill="#fff" />
      <path d="M13.2 18.6c1.6 1.3 4 1.3 5.6 0" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** An organization's logo, or the default mark. `name` is the accessible label. */
export function OrgLogo({ src, name, size = 28, className }: { src?: string | null; name: string; size?: number; className?: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      className={cx("shrink-0 rounded-lg object-contain", className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span className={cx("inline-flex shrink-0", className)} role="img" aria-label={`${name} (default logo)`}>
      <DefaultMark size={size} />
    </span>
  );
}
