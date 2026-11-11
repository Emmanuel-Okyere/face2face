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
                  className="flex max-w-[180px] items-center gap-1.5 rounded-full border border-line/80 bg-surface px-3 py-1.5 text-sm"
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
            </Suspense>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/kiosk"
                title="Open kiosk"
                className="hidden size-9 items-center justify-center rounded-full border border-line/80 bg-surface/70 text-ink/70 hover:text-ink sm:flex"
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
        <main className="mx-auto w-full max-w-[1400px] min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
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
      </div>
    </MeContext>
  );
}

function pathIsPlatform() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/admin/platform");
}

/** Reads the pathname, so it streams in its own boundary (Cache Components). */
function NavLinks() {
  const path = usePathname();
  return (
    <nav className="-mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 md:justify-center">
      {NAV.map(([href, label, d]) => {
        const active = href === "/admin" ? path === "/admin" : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cx(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm transition",
              active ? "bg-ink text-white" : "border border-line/80 bg-surface/70 text-ink/75 hover:bg-surface hover:text-ink",
            )}
          >
            <Icon d={d} className="size-3.5" />
            {label}
          </Link>
        );
      })}
    </nav>
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
