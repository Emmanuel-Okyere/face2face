import Link from "next/link";
import { Logo } from "@/components/ui";

export default function Home() {
  return (
    <div className="grid-bg relative flex min-h-dvh flex-col overflow-hidden">
      {/* soft colour wash behind the mock-up */}
      <div aria-hidden className="pointer-events-none absolute -right-40 top-10 size-[42rem] rounded-full bg-good-soft/60 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-[30rem] rounded-full bg-accent/10 blur-3xl" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <Link href="/admin" className="rounded-full border border-line bg-surface/70 px-4 py-1.5 text-sm backdrop-blur hover:bg-surface">
          Sign in
        </Link>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-6 pb-16 pt-4 lg:grid-cols-[1fr_1.05fr] lg:gap-10">
        <section>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
            Check in
            <br />
            with a <span className="text-accent">smile.</span>
          </h1>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/kiosk" className="rounded-full bg-ink px-6 py-3 font-medium text-white transition hover:bg-ink/85">
              Open kiosk
            </Link>
          </div>
        </section>

        <KioskPreview />
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-6 text-xs text-muted">© {2026} Face2Face</footer>
    </div>
  );
}

/** A looping, illustrated kiosk check-in: face found → brackets lock green → welcome card. */
function KioskPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl" aria-label="Illustration of a kiosk check-in" role="img">
      {/* the device */}
      <div className="card-shadow rounded-[34px] border border-line/70 bg-surface p-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[26px] bg-gradient-to-b from-[#3a3d42] to-[#26282b]">
          <svg viewBox="0 0 400 300" className="absolute inset-0 size-full">
            {/* person */}
            <path d="M95 300c8-58 52-86 105-86s97 28 105 86z" fill="#4d5157" />
            <rect x="182" y="178" width="36" height="44" rx="14" fill="#565a61" />
            <ellipse cx="200" cy="132" rx="52" ry="64" fill="#5d6168" />
            <path d="M148 120c2-44 26-66 52-66s50 22 52 66c-10-22-28-30-52-30s-42 8-52 30z" fill="#3b3e43" />
            {/* face points (what the engine tracks) */}
            <g className="land-dots" fill="#fff">
              {[
                [170, 128], [182, 124], [194, 128], [206, 128], [218, 124], [230, 128],
                [176, 140], [188, 140], [212, 140], [224, 140],
                [200, 150], [200, 160], [192, 166], [208, 166],
                [184, 178], [192, 181], [200, 182], [208, 181], [216, 178],
                [160, 150], [164, 170], [172, 188], [186, 198], [200, 201], [214, 198], [228, 188], [236, 170], [240, 150],
              ].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r="1.6" />
              ))}
            </g>
            {/* brackets: white while finding, then green */}
            <g className="land-brackets" fill="none" strokeWidth="6" strokeLinecap="round">
              <path d="M134 98 Q134 70 162 70" />
              <path d="M238 70 Q266 70 266 98" />
              <path d="M134 186 Q134 214 162 214" />
              <path d="M238 214 Q266 214 266 186" />
            </g>
          </svg>
          <div className="land-hint absolute inset-x-0 bottom-4 flex justify-center">
            <span className="rounded-full bg-surface px-4 py-1.5 text-sm font-medium shadow-lg">Now give us a smile</span>
          </div>
        </div>
      </div>

      {/* welcome card that rises after the match */}
      <div className="land-welcome card-shadow absolute -bottom-8 -left-4 flex w-[18rem] items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3.5 pr-4 sm:-left-10">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-good-soft text-sm font-semibold text-good">AM</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-tight">Ama Mensah</div>
          <div className="mt-0.5 truncate text-xs text-muted">Checked in at 8:42 am</div>
        </div>
        <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
          <circle cx="12" cy="12" r="11" fill="var(--good)" />
          <path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* live count */}
      <div className="card-shadow absolute -right-2 -top-6 flex items-center gap-3 rounded-2xl border border-line/70 bg-surface px-4 py-3 sm:-right-8">
        <svg viewBox="0 0 36 36" className="size-10 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-2)" strokeWidth="4" />
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--good)" strokeWidth="4" strokeLinecap="round" strokeDasharray="86 94.2" />
        </svg>
        <div>
          <div className="text-xl font-semibold tabular-nums leading-none">128</div>
          <div className="text-[11px] text-muted">present today</div>
        </div>
      </div>
    </div>
  );
}
