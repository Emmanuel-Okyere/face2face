"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, Avatar, cx, hardNavigate, Logo, OrgLogo } from "@/components/ui";
import { prefetchFaceModels } from "@/lib/face/models";

type Me = { id: string; email: string; name: string; isPlatform: boolean };
export type CurrentOrg = { id: string; name: string; slug: string; role: "owner" | "admin"; timeZone: string; lateAfter: string | null; selfCheckin: boolean; logoUrl: string | null };
type OrgLite = { id: string; name: string; slug: string; role: string; logoUrl: string | null };
type MeResponse = { admin: Me; org: CurrentOrg | null; orgs: OrgLite[]; mailEnabled?: boolean };

const MeContext = createContext<MeResponse | null>(null);
/** The signed-in admin. */
export const useMe = () => useContext(MeContext)?.admin ?? null;
/** The organization the admin is working in. */
export const useOrg = () => useContext(MeContext)?.org ?? null;
/** Whether the server can send email (invites, password resets). */
export const useMailEnabled = () => useContext(MeContext)?.mailEnabled ?? false;

const NAV = [
  ["/admin", "Dashboard", "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"],
  ["/admin/people", "People", "M16 11a4 4 0 1 0-8 0M4 21a8 8 0 0 1 16 0"],
  ["/admin/services", "Services", "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
  ["/admin/events", "Events", "M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6"],
  ["/admin/attendance", "Attendance", "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"],
  ["/admin/reports", "Reports", "M4 20V10M10 20V4M16 20v-7M22 20H2"],
  ["/admin/import", "Import", "M12 3v12m0 0-4-4m4 4 4-4M4 21h16"],
  ["/admin/kiosks", "Kiosks", "M4 5h16v11H4zM9 20h6M12 16v4"],
  [
    "/admin/settings",
    "Settings",
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 1.2 14H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 1.2V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ],
] as const;

function Icon({ d, className = "size-4" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [orgMenu, setOrgMenu] = useState(false);
  const orgRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Quietly warm the browser cache with the face models so enrollment and the
    // kiosk start instantly later (immutable files, cached for a year).
    prefetchFaceModels();
    api<MeResponse>("/api/admin/me")
      .then(setMe)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
      if (!orgRef.current?.contains(e.target as Node)) setOrgMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const switchOrg = async (orgId: string) => {
    await api("/api/admin/switch-org", { method: "POST", json: { orgId } });
    // Hard reload: every cached list belongs to the previous organization.
    hardNavigate("/admin");
  };

  const logout = async (all = false) => {
    await fetch(`/api/auth/logout${all ? "?all=1" : ""}`, { method: "POST" });
    router.replace("/login");
  };

  return (
    <MeContext value={me}>
      <div className="grid-bg flex min-h-dvh flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
            <Link href="/admin" className="shrink-0">
              <Logo />
            </Link>
            {me && (me.orgs.length > 0 || me.admin.isPlatform) && (
              <div className="relative shrink-0" ref={orgRef}>
                <button
                  onClick={() => setOrgMenu((o) => !o)}
                  aria-expanded={orgMenu}
                  className="flex max-w-[150px] items-center gap-1.5 rounded-full border border-line/80 bg-surface px-3 py-1.5 text-sm sm:max-w-[180px]"
                >
                  <OrgLogo src={me.org?.logoUrl} name={me.org?.name ?? "Organization"} size={20} className="rounded-md" />
                  <span className="truncate font-medium">{me.org?.name ?? "Choose organization"}</span>
                  <span className="text-muted">▾</span>
                </button>
                {orgMenu && (
                  <div className="card-shadow absolute left-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-surface p-1.5 text-sm">
                    <div className="px-3 py-1.5 text-xs text-muted">Organizations</div>
                    <div className="max-h-72 overflow-auto">
                      {me.orgs.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => switchOrg(o.id)}
                          className={cx("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-surface-2", o.id === me.org?.id && "bg-surface-2")}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <OrgLogo src={o.logoUrl} name={o.name} size={18} className="rounded" />
                            <span className="truncate">{o.name}</span>
                          </span>
                          <span className="text-xs text-muted">{o.id === me.org?.id ? "✓" : o.role}</span>
                        </button>
                      ))}
                    </div>
                    {me.admin.isPlatform && (
                      <>
                        <div className="my-1 h-px bg-line" />
                        <Link href="/admin/platform" onClick={() => setOrgMenu(false)} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                          ＋ New organization / manage all
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <Suspense fallback={<div className="flex-1" />}>
              <NavLinks />
              <MenuButton />
            </Suspense>
            <div className="flex-1 md:hidden" />
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/kiosk"
                title="Open kiosk"
                className="hidden size-9 items-center justify-center rounded-full border border-line/80 bg-surface/70 text-ink/70 hover:text-ink xl:flex"
              >
                <Icon d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0" />
              </Link>
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenu((m) => !m)} className="rounded-full" aria-label="Account menu" aria-expanded={menu}>
                  <Avatar name={me?.admin.name || me?.admin.email || "?"} size={36} />
                </button>
                {menu && (
                  <div className="card-shadow absolute right-0 mt-2 w-60 rounded-2xl border border-line bg-surface p-1.5 text-sm">
                    <div className="px-3 py-2">
                      <div className="font-medium">{me?.admin.name}</div>
                      <div className="truncate text-xs text-muted">{me?.admin.email}</div>
                    </div>
                    <div className="my-1 h-px bg-line" />
                    <Link href="/admin/settings#security" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                      Security &amp; sessions
                    </Link>
                    {me?.admin.isPlatform && (
                      <Link href="/admin/platform" onClick={() => setMenu(false)} className="block rounded-lg px-3 py-2 hover:bg-surface-2">
                        Platform · all organizations
                      </Link>
                    )}
                    <button onClick={() => logout()} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-surface-2">
                      Sign out
                    </button>
                    <button
                      onClick={() => logout(true)}
                      className="block w-full rounded-lg px-3 py-2 text-left text-danger hover:bg-danger/5"
                    >
                      Sign out everywhere
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-6 sm:pt-8 md:pb-8">
          {me && !me.org && !pathIsPlatform() ? (
            <div className="mx-auto max-w-md rounded-3xl border border-dashed border-line p-10 text-center">
              <p className="text-lg font-medium">You&apos;re not part of an organization yet</p>
              <p className="mt-1 text-sm text-muted">
                {me.admin.isPlatform ? "Create the first one to get started." : "Ask an organization owner to add you."}
              </p>
              {me.admin.isPlatform && (
                <Link href="/admin/platform" className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-sm text-white">
                  Create organization
                </Link>
              )}
            </div>
          ) : (
            children
          )}
        </main>
        <Suspense>
          <BottomBar />
        </Suspense>
      </div>
    </MeContext>
  );
}

function pathIsPlatform() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin/platform");
}

// Main sections get a pill on wide screens; the rest live under "More".
const PRIMARY = new Set(["/admin", "/admin/people", "/admin/services", "/admin/events", "/admin/attendance", "/admin/reports"]);
// Phone bottom bar: the four things people do most, plus More.
const TABS = ["/admin", "/admin/people", "/admin/events", "/admin/attendance"];
const SHORT: Record<string, string> = { "/admin": "Home" };
const KIOSK_ICON = "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0";
const MORE_ICON = "M4 6h16M4 12h16M4 18h16";

const isActive = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));

/** Wide screens: pills for the main sections + a More dropdown. Reads the pathname, so it streams in its own boundary. */
function NavLinks() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const more = NAV.filter(([href]) => !PRIMARY.has(href));
  const activeMore = more.find(([href]) => isActive(path, href));
  return (
    <nav className="hidden flex-1 items-center justify-center gap-1 xl:flex">
      {NAV.filter(([href]) => PRIMARY.has(href)).map(([href, label, d]) => (
        <Link
          key={href}
          href={href}
          className={cx(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition",
            isActive(path, href) ? "bg-ink text-white" : "border border-line/80 bg-surface/70 text-ink/75 hover:bg-surface hover:text-ink",
          )}
        >
          <Icon d={d} className="size-3.5" />
          {label}
        </Link>
      ))}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cx(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition",
            activeMore ? "bg-ink text-white" : "border border-line/80 bg-surface/70 text-ink/75 hover:bg-surface hover:text-ink",
          )}
        >
          {activeMore ? activeMore[1] : "More"} <span className="text-xs opacity-70">▾</span>
        </button>
        {open && (
          <div className="card-shadow absolute right-0 z-40 mt-2 w-52 rounded-2xl border border-line bg-surface p-1.5 text-sm">
            {more.map(([href, label, d]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-surface-2", isActive(path, href) && "bg-surface-2 font-medium")}
              >
                <Icon d={d} className="size-4 text-muted" />
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

/** Every section as big tiles: the menu on tablets and the "More" sheet on phones. */
function MenuSheet({ onClose }: { onClose: () => void }) {
  const path = usePathname();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label="Menu">
      <button className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={onClose} aria-label="Close menu" />
      <div className="card-shadow absolute inset-x-3 bottom-3 rounded-3xl border border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:bottom-auto md:left-auto md:right-6 md:top-16 md:w-[26rem]">
        <div className="grid grid-cols-3 gap-2">
          {NAV.map(([href, label, d]) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cx(
                "flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3.5 text-xs transition",
                isActive(path, href) ? "bg-ink text-white" : "bg-surface-2/60 text-ink/80 hover:bg-surface-2",
              )}
            >
              <Icon d={d} className="size-5" />
              {label}
            </Link>
          ))}
        </div>
        <Link href="/kiosk" onClick={onClose} className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm hover:bg-surface-2">
          <Icon d={KIOSK_ICON} className="size-4" /> Open kiosk
        </Link>
      </div>
    </div>
  );
}

/** Tablets / narrow windows: one Menu button in the header. */
function MenuButton() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const current = NAV.find(([href]) => isActive(path, href));
  return (
    <div className="hidden flex-1 justify-end md:flex xl:hidden">
      <button onClick={() => setOpen(true)} aria-expanded={open} className="flex items-center gap-2 rounded-full border border-line/80 bg-surface px-3.5 py-1.5 text-sm">
        <Icon d={MORE_ICON} className="size-4" />
        {current?.[1] ?? "Menu"}
      </button>
      {open && <MenuSheet onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Phones: a bottom tab bar within thumb reach. */
function BottomBar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const inMore = !TABS.some((t) => isActive(path, t));
  return (
    <>
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((href) => {
            const [, label, d] = NAV.find(([h]) => h === href)!;
            const on = isActive(path, href);
            return (
              <Link key={href} href={href} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", on ? "text-ink" : "text-muted")}>
                <span className={cx("flex h-7 w-12 items-center justify-center rounded-full transition", on && "bg-ink text-white")}>
                  <Icon d={d} className="size-[18px]" />
                </span>
                {SHORT[href] ?? label}
              </Link>
            );
          })}
          <button onClick={() => setOpen(true)} className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px]", inMore ? "text-ink" : "text-muted")}>
            <span className={cx("flex h-7 w-12 items-center justify-center rounded-full", inMore && "bg-ink text-white")}>
              <Icon d={MORE_ICON} className="size-[18px]" />
            </span>
            More
          </button>
        </div>
      </nav>
      {open && <MenuSheet onClose={() => setOpen(false)} />}
    </>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-normal tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
