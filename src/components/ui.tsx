"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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
        "w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-muted/80",
        "focus:outline-none focus:border-ink/40 focus:ring-4 focus:ring-ink/5",
        className,
      )}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card-shadow rounded-2xl border border-line/70 bg-surface p-5", className)}>{children}</div>;
}

export function Pill({ tone = "muted", children }: { tone?: "accent" | "good" | "warn" | "danger" | "info" | "muted"; children: ReactNode }) {
  const tones = {
    accent: "bg-accent/10 text-accent border-accent/25",
    good: "bg-good-soft/70 text-good border-good/25",
    warn: "bg-warn/12 text-warn border-warn/25",
    danger: "bg-danger/12 text-danger border-danger/25",
    info: "bg-info/12 text-info border-info/25",
    muted: "bg-surface-2 text-muted border-line",
  };
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone])}>
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
