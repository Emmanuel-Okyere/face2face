"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Button, Card, cx, Field, Input } from "@/components/ui";
import { plural } from "@/lib/camp/format";
import { DEFAULT_FORM } from "./RegistrationForm";
import FormBuilder, { Switch } from "./FormBuilder";
import type { TabProps } from "./types";
import { ask, toast, toastError } from "@/components/feedback";


export default function Setup({ d, reload }: TabProps) {
  const router = useRouter();
  const e = d.event;
  const [f, setFState] = useState({
    name: e.name,
    venue: e.venue ?? "",
    starts_on: e.starts_on ?? "",
    ends_on: e.ends_on ?? "",
    registration_open: e.registration_open,
    churches: e.churches,
    age_groups: e.age_groups,
    child_age: e.child_age,
    unit_label: e.unit_label,
    questions: e.questions,
    rooms_enabled: e.rooms_enabled,
    buses_enabled: e.buses_enabled,
    form: { ...DEFAULT_FORM, ...(e.form ?? {}) },
    archived: e.archived,
  });
  const setF = (p: Partial<typeof f>) => setFState({ ...f, ...p });
  const [churchText, setChurchText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (patch: Partial<typeof f> = {}) => {
    // Start from the whole saved event so settings managed elsewhere (meals…) are kept.
    const body = { ...e, ...f, ...patch };
    setBusy(true);
    setMsg("");
    try {
      await api(`/api/admin/events/${e.id}`, { method: "PUT", json: body });
      setFState({ ...f, ...patch });
      toast("Event saved");
      await reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Paste a whole list at once: one per line or comma-separated.
  const addChurches = () => {
    const add = churchText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    setF({ churches: [...new Set([...f.churches, ...add])] });
    setChurchText("");
  };
  return (
    // noValidate: the live form preview inside has its own required fields, which must not block saving.
    <form
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <Input required value={f.name} onChange={(ev) => setF({ name: ev.target.value })} />
        </Field>
        <Field label="Venue">
          <Input value={f.venue} onChange={(ev) => setF({ venue: ev.target.value })} />
        </Field>
        <Field label="Starts">
          <Input type="date" value={f.starts_on} onChange={(ev) => setF({ starts_on: ev.target.value })} />
        </Field>
        <Field label="Ends">
          <Input type="date" value={f.ends_on} onChange={(ev) => setF({ ends_on: ev.target.value })} />
        </Field>
        <label className="flex items-center gap-3 text-sm sm:col-span-2">
          <button
            type="button"
            role="switch"
            aria-checked={f.registration_open}
            onClick={() => setF({ registration_open: !f.registration_open })}
            className={cx("relative h-6 w-11 rounded-full transition", f.registration_open ? "bg-good" : "bg-line")}
          >
            <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", f.registration_open ? "left-[22px]" : "left-0.5")} />
          </button>
          Registration is {f.registration_open ? "open" : "closed"}
        </label>
      </Card>

      <Card>
        <div className="mb-1 font-medium">Allocate</div>
        <div className="grid gap-x-8 sm:grid-cols-2">
          <label className="flex items-center gap-3 py-2">
            <Switch on={f.rooms_enabled} onChange={(v) => setF({ rooms_enabled: v })} label="Rooms & beds" />
            <span>
              <span className="block text-sm">Rooms &amp; beds</span>
              <span className="block text-xs text-muted">Rooms tab, automatic bed assignment, room SMS</span>
            </span>
          </label>
          <label className="flex items-center gap-3 py-2">
            <Switch on={f.buses_enabled} onChange={(v) => setF({ buses_enabled: v })} label="Bus seats" />
            <span>
              <span className="block text-sm">Bus seats</span>
              <span className="block text-xs text-muted">Asks who needs the bus; seat numbers, manifests, bus SMS</span>
            </span>
          </label>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-medium">{plural(f.unit_label || "Church")}</div>
            {!f.churches.length && <p className="text-xs text-warn">Add at least one to open registration.</p>}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            Called
            <Input value={f.unit_label} maxLength={30} onChange={(ev) => setF({ unit_label: ev.target.value })} className="w-32 py-1" aria-label="What to call these groups" />
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {f.churches.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1 text-sm">
              {c}
              <button type="button" onClick={() => setF({ churches: f.churches.filter((x) => x !== c) })} className="text-muted hover:text-danger" aria-label={`Remove ${c}`}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea
            value={churchText}
            onChange={(ev) => setChurchText(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                addChurches();
              }
            }}
            rows={1}
            placeholder={`Type a ${(f.unit_label || "church").toLowerCase()} and press Enter, or paste a list`}
            className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm"
          />
          <Button type="button" variant="ghost" onClick={addChurches} disabled={!churchText.trim()}>
            Add
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <div>
          <div className="font-medium">Age groups</div>
        </div>
        <div className="space-y-2">
          {f.age_groups.map((g, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 whitespace-nowrap text-sm">
              <Input value={g.name} onChange={(ev) => setF({ age_groups: f.age_groups.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) })} className="w-44" />
              <span className="text-muted">up to age</span>
              <Input
                type="number"
                min={0}
                max={150}
                value={g.upTo}
                onChange={(ev) => setF({ age_groups: f.age_groups.map((x, j) => (j === i ? { ...x, upTo: Number(ev.target.value) } : x)) })}
                className="w-20"
              />
              {f.age_groups.length > 1 && (
                <button type="button" onClick={() => setF({ age_groups: f.age_groups.filter((_, j) => j !== i) })} className="text-muted hover:text-danger" aria-label="Remove group">
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" onClick={() => setF({ age_groups: [...f.age_groups, { name: "New group", upTo: 150 }] })} className="text-xs text-muted hover:text-ink">
            + Add group
          </button>
        </div>
        <label className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          Children aged
          <Input type="number" min={0} max={21} value={f.child_age} onChange={(ev) => setF({ child_age: Number(ev.target.value) })} className="w-20" />
          and under stay in a room with a parent.
        </label>
      </Card>

      <FormBuilder
        d={{
          form: f.form,
          questions: f.questions,
          rooms: f.rooms_enabled,
          buses: f.buses_enabled,
          churches: f.churches,
          unit: f.unit_label,
          age_groups: f.age_groups,
          child_age: f.child_age,
          starts_on: f.starts_on,
          ends_on: f.ends_on,
        }}
        onForm={(form) => setF({ form })}
        onQuestions={(questions) => setF({ questions })}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="subtle"
          onClick={async () => {
            await save({ archived: !f.archived, registration_open: f.archived ? f.registration_open : false });
          }}
        >
          {f.archived ? "Unarchive" : "Archive event"}
        </Button>
        <Button
          type="button"
          variant="subtle"
          className="text-danger"
          onClick={async () => {
            const ok = await ask({
              title: `Delete “${e.name}”?`,
              body: "Every registration, room, bus, message and saved insight in it is deleted. This can't be undone.",
              typeToConfirm: e.name,
              confirm: "Delete event",
              danger: true,
            });
            if (!ok) return;
            try {
              await api(`/api/admin/events/${e.id}`, { method: "DELETE" });
              toast(`${e.name} deleted`);
              router.push("/admin/events");
            } catch (err) {
              toastError(err);
            }
          }}
        >
          Delete event
        </Button>
        {msg && <span className="ml-auto text-sm text-muted">{msg}</span>}
        <Button type="submit" loading={busy} className={msg ? "" : "ml-auto"}>
          Save
        </Button>
      </div>
    </form>
  );
}

