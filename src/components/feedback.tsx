"use client";

// In-app confirmations and toasts, replacing the browser's confirm/alert/prompt.
// Call from anywhere (no hook needed):
//   if (!(await ask({ title: "Delete room 3?", danger: true }))) return;
//   toast("Saved");  toast(err.message, "danger");
// <FeedbackHost /> (mounted once in the root layout) draws them.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui";

type AskOpts = {
  title: string;
  body?: ReactNode;
  confirm?: string; // button label, default "OK"
  cancel?: string;
  danger?: boolean; // red confirm button for destructive actions
  /** Make them type this exactly before confirming (e.g. an event's name). */
  typeToConfirm?: string;
  /** Ask for a value instead (askText). */
  input?: { label: string; type?: "text" | "password"; placeholder?: string; autoComplete?: string };
};
type Dialog = AskOpts & { id: number; resolve: (v: string | boolean | null) => void };
type Toast = { id: number; message: string; tone: "good" | "danger" | "info" };

let seq = 0;
let dialogs: Dialog[] = [];
let toasts: Toast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));

/** A confirmation dialog. Resolves true (confirmed) or false (cancelled). */
export function ask(opts: AskOpts): Promise<boolean> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { ...opts, id: ++seq, resolve: (v) => resolve(v === true || typeof v === "string") }];
    emit();
  });
}

/** A dialog that asks for a value (e.g. a password). Resolves the text, or null if cancelled. */
export function askText(opts: AskOpts & { input: NonNullable<AskOpts["input"]> }): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { ...opts, id: ++seq, resolve: (v) => resolve(typeof v === "string" ? v : null) }];
    emit();
  });
}

/** A short message that disappears by itself. */
export function toast(message: string, tone: Toast["tone"] = "good") {
  const t = { id: ++seq, message, tone };
  toasts = [...toasts.slice(-2), t]; // at most 3 on screen
  emit();
  setTimeout(() => dismiss(t.id), tone === "danger" ? 6500 : 3500);
}
/** Show a toast after a full page load (e.g. right before hardNavigate). */
export function toastNextPage(message: string, tone: Toast["tone"] = "good") {
  try {
    sessionStorage.setItem("f2f:toast", JSON.stringify({ message, tone }));
  } catch {}
}

/** Shorthand for a failed action. */
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "danger");

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}
function close(d: Dialog, value: string | boolean | null) {
  dialogs = dialogs.filter((x) => x.id !== d.id);
  emit();
  d.resolve(value);
}

export function FeedbackHost() {
  const ds = useSyncExternalStore(subscribe, () => dialogs, () => dialogs);
  const ts = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("f2f:toast");
      if (pending) {
        sessionStorage.removeItem("f2f:toast");
        const t = JSON.parse(pending) as { message: string; tone: Toast["tone"] };
        toast(t.message, t.tone);
      }
    } catch {}
  }, []);
  return (
    <>
      {ds[0] && <DialogView key={ds[0].id} d={ds[0]} />}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {ts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : "status"}
            className="toast-in card-shadow pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface py-2.5 pl-3 pr-2 text-sm"
          >
            <span
              className={cx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs text-white",
                t.tone === "good" ? "bg-good" : t.tone === "danger" ? "bg-danger" : "bg-ink",
              )}
              aria-hidden
            >
              {t.tone === "good" ? "✓" : t.tone === "danger" ? "!" : "i"}
            </span>
            <span className="min-w-0 flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function DialogView({ d }: { d: Dialog }) {
  const [text, setText] = useState("");
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const needsText = !!d.typeToConfirm || !!d.input;
  const ready = d.typeToConfirm ? text.trim() === d.typeToConfirm.trim() : d.input ? text.length > 0 : true;
  const ok = () => ready && close(d, d.input ? text : true);

  useEffect(() => {
    (needsText ? inputRef.current : okRef.current)?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close(d, d.input ? null : false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [d, needsText]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center" role="alertdialog" aria-modal aria-labelledby={`dlg-${d.id}`}>
      <button className="absolute inset-0 bg-ink/25 backdrop-blur-sm" onClick={() => close(d, d.input ? null : false)} aria-label="Cancel" tabIndex={-1} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
        className="dialog-in card-shadow relative w-full max-w-sm rounded-3xl border border-line bg-surface p-5"
      >
        <h2 id={`dlg-${d.id}`} className="text-base font-semibold leading-snug">
          {d.title}
        </h2>
        {d.body && <div className="mt-1.5 whitespace-pre-line text-sm text-muted">{d.body}</div>}
        {needsText && (
          <label className="mt-4 block space-y-1.5">
            <span className="block text-xs font-medium text-muted">{d.input?.label ?? <>Type <b className="text-ink">{d.typeToConfirm}</b> to confirm</>}</span>
            <input
              ref={inputRef}
              type={d.input?.type ?? "text"}
              autoComplete={d.input?.autoComplete ?? "off"}
              placeholder={d.input?.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3.5 py-2 text-sm outline-none focus:border-ink/40 focus:ring-4 focus:ring-ink/5"
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => close(d, d.input ? null : false)} className="rounded-full border border-line px-4 py-2 text-sm hover:bg-surface-2">
            {d.cancel ?? "Cancel"}
          </button>
          <button
            ref={okRef}
            type="submit"
            disabled={!ready}
            className={cx("rounded-full px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40", d.danger ? "bg-danger hover:bg-danger/90" : "bg-ink hover:bg-ink/85")}
          >
            {d.confirm ?? "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}
