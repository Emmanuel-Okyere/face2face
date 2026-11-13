import Link from "next/link";
import type { ReactNode } from "react";
import AuthFeed from "@/components/AuthFeed";
import { Logo } from "@/components/ui";

/** Sign-in, reset and set-password pages: a brand panel beside the form (form only on phones). */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#1d1d1b] p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-24 size-[30rem] rounded-full bg-accent/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-good/25 blur-3xl" />

        <Link href="/" className="relative z-10 w-fit text-white [&_span]:text-white">
          <Logo />
        </Link>

        <div className="relative z-10 my-auto max-w-md">
          <h2 className="text-5xl font-semibold leading-[1.05] tracking-tight">
            Every face,
            <br />
            <span className="text-accent">checked in.</span>
          </h2>

          <AuthFeed />
        </div>

        <div className="relative z-10 text-xs text-white/40">© 2026 Face2Face</div>
      </aside>

      <main className="grid-bg relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="lg:invisible">
            <Logo />
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface/70 px-3.5 py-1.5 text-sm text-muted backdrop-blur hover:text-ink">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Home
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
