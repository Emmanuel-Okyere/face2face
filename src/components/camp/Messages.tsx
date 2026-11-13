"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Button, Card, Pill, timeAgo } from "@/components/ui";
import type { TabProps } from "./types";
import { ask, toast, toastError } from "@/components/feedback";

type Msg = { id: string; channel: "sms" | "email"; recipient: string; kind: string; body: string; status: string; error: string | null; created_at: string; contact_name: string | null; church: string | null };
type Kind = "registered" | "room" | "bus" | "broadcast";

const ACTIONS: { kind: Exclude<Kind, "broadcast">; title: string; text: string }[] = [
  { kind: "registered", title: "Pass links", text: "Anyone without a pass yet." },
  { kind: "room", title: "Room details", text: "Only new or changed rooms are sent." },
  { kind: "bus", title: "Bus seats", text: "Only new or changed seats are sent." },
];

export default function Messages({ d, reload }: TabProps) {
  const [log, setLog] = useState<Msg[] | null>(null);
  const [busy, setBusy] = useState<Kind | "">("");
  const [progress, setProgress] = useState<{ sent: number; failed: number; left: number } | null>(null);
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [church, setChurch] = useState("");
  const load = useCallback(() => api<{ messages: Msg[] }>(`/api/admin/events/${d.event.id}/messages`).then((r) => setLog(r.messages)), [d.event.id]);
  useEffect(() => {
    load();
  }, [load]);
  const enabled = d.channels.sms || d.channels.email;

  /** Send queued messages in batches until none are left, showing progress. */
  const drain = async () => {
    let total = { sent: 0, failed: 0, left: 1 };
    for (let i = 0; i < 500 && total.left > 0; i++) {
      const r = await api<{ sent: number; failed: number; left: number }>(`/api/admin/events/${d.event.id}/messages`, { method: "PUT" });
      total = { sent: total.sent + r.sent, failed: total.failed + r.failed, left: r.left };
      setProgress(total);
      if (r.sent + r.failed === 0 && r.left > 0) await new Promise((res) => setTimeout(res, 1500)); // retries waiting
    }
    return total;
  };

  const queue = async (kind: Kind) => {
    if (kind === "broadcast" && !(await ask({ title: `Send to ${church || "everyone"}?`, body: `“${text}”`, confirm: "Send" }))) return;
    setBusy(kind);
    setNote("");
    setProgress(null);
    try {
      const q = await api<{ queued: number; skipped: number }>(`/api/admin/events/${d.event.id}/messages`, {
        method: "POST",
        json: { kind, ...(kind === "broadcast" ? { body: text, church: church || null } : {}) },
      });
      if (!q.queued) toast("Nothing new to send — everyone already has the latest", "info");
      else {
        const r = await drain();
        setNote("");
        if (r.failed) toast(`${r.sent} sent, ${r.failed} failed — see the list below`, "danger");
        else toast(`${r.sent} ${r.sent === 1 ? "message" : "messages"} sent`);
        if (kind === "broadcast") setText("");
      }
      await Promise.all([load(), reload()]);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };

  const failed = log?.filter((m) => m.status === "failed").length ?? 0;
  const parts = Math.max(1, Math.ceil((d.event.name.length + 2 + text.length) / 153));

  return (
    <div className="space-y-4">
      {!enabled ? (
        <Card className="text-sm">
          <div className="font-medium">SMS isn&apos;t set up yet</div>
          <p className="mt-1 text-muted">
            Add your GIANT SMS details to the server&apos;s environment: <code>GIANTSMS_SENDER_ID</code> plus either <code>GIANTSMS_TOKEN</code> or{" "}
            <code>GIANTSMS_USERNAME</code> and <code>GIANTSMS_PASSWORD</code>. Registrations with an email address get email too when email is set up.
          </p>
        </Card>
      ) : (
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tone={d.channels.sms ? "good" : "muted"}>SMS {d.channels.sms ? "on" : "off"}</Pill>
          <Pill tone={d.channels.email ? "good" : "muted"}>Email {d.channels.email ? "on" : "off"}</Pill>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {ACTIONS.filter((a) => (a.kind !== "room" || d.event.rooms_enabled) && (a.kind !== "bus" || d.event.buses_enabled)).map((a) => (
          <Card key={a.kind} className="flex flex-col gap-3 p-4">
            <div className="font-medium">{a.title}</div>
            <p className="flex-1 text-xs text-muted">{a.text}</p>
            <Button onClick={() => queue(a.kind)} loading={busy === a.kind} disabled={!enabled || !!busy}>
              Send
            </Button>
          </Card>
        ))}
      </div>

      <Card className="space-y-3">
        <div className="font-medium">Announcement</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={480}
          rows={3}
          placeholder="Buses leave at 6 am sharp from each chapel. Bring your Bible and a torch."
          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <select value={church} onChange={(e) => setChurch(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <option value="">Every church</option>
            {[...new Set(d.households.map((h) => h.church))].sort().map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {text.length} characters · {parts} SMS per registration
          </span>
          <Button className="ml-auto" onClick={() => queue("broadcast")} loading={busy === "broadcast"} disabled={!enabled || !text.trim() || !!busy}>
            Send announcement
          </Button>
        </div>
      </Card>

      {(note || progress) && (
        <p className="text-sm text-muted">
          {busy && progress ? `Sending… ${progress.sent} sent, ${progress.left} to go` : note}
        </p>
      )}

      <Card className="p-0">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="font-medium">Sent messages</div>
          {failed > 0 && (
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={async () => {
                await api(`/api/admin/events/${d.event.id}/messages`, { method: "PATCH" });
                setBusy("broadcast");
                await drain().finally(() => setBusy(""));
                await load();
              }}
            >
              Retry {failed} failed
            </Button>
          )}
        </div>
        {!log?.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-line/70 overflow-y-auto">
            {log.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <div className="w-40 min-w-0">
                  <div className="truncate">{m.contact_name ?? m.recipient}</div>
                  <div className="truncate text-xs text-muted">
                    {m.channel === "sms" ? m.recipient : m.recipient} · {timeAgo(m.created_at)}
                  </div>
                </div>
                <div className="min-w-0 flex-1 whitespace-pre-line text-xs text-ink/80">{m.body}</div>
                <span className="shrink-0" title={m.error ?? undefined}>
                  <Pill tone={m.status === "sent" ? "good" : m.status === "failed" ? "danger" : "muted"}>{m.status === "sent" ? "Sent" : m.status === "failed" ? "Failed" : "Waiting"}</Pill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
