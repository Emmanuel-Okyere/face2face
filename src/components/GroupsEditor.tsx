"use client";

import { useEffect, useState } from "react";
import { fieldsChanged, useOrgFields } from "@/components/FieldsEditor";
import { api, Button, Card, Input } from "@/components/ui";
import { toast } from "@/components/feedback";

/**
 * The organization's groups (Children, Youth, Adults, Choir…). They become a
 * dropdown when enrolling people, can be targeted by services (a Children's
 * service and an Adult service running at once), and split every report.
 * Stored as the options of the built-in Group field.
 */
export default function GroupsEditor({ canEdit }: { canEdit: boolean }) {
  const fields = useOrgFields();
  const field = fields?.find((f) => f.key === "group_name");
  const saved = field?.type === "select" ? field.options ?? [] : [];
  const [list, setList] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [inUse, setInUse] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = list ?? saved;
  const dirty = list !== null && list.join("\u0000") !== saved.join("\u0000");

  // Groups people already have (typed before the list existed) — offered as one-click adds.
  useEffect(() => {
    api<{ groups: string[] }>("/api/admin/services").then((r) => setInUse(r.groups));
  }, []);
  const missing = inUse.filter((g) => !groups.some((x) => x.toLowerCase() === g.toLowerCase()));

  const add = (names: string[]) => {
    const next = [...groups];
    for (const n of names.map((s) => s.trim()).filter(Boolean)) if (!next.some((x) => x.toLowerCase() === n.toLowerCase())) next.push(n.slice(0, 60));
    setList(next);
    setText("");
  };
  const save = async () => {
    if (!fields || !field) return;
    setBusy(true);
    setMsg("");
    try {
      const next = fields.map((f) =>
        f.key === "group_name" ? { ...f, enabled: true, type: groups.length ? ("select" as const) : ("text" as const), options: groups.length ? groups : undefined } : f,
      );
      await api("/api/admin/org/fields", { method: "PUT", json: { fields: next } });
      setList(null);
      toast("Groups saved");
      fieldsChanged();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Groups</h2>
          <p className="text-xs text-muted">Picked from a list when enrolling. Services can be for a group, and reports split by group.</p>
        </div>
        {canEdit && dirty && (
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {groups.length === 0 && <span className="text-sm text-muted">No groups yet — people can be in any group typed in.</span>}
        {groups.map((g, i) => (
          <span key={g} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1.5 text-sm">
            {canEdit && i > 0 && (
              <button onClick={() => setList(groups.map((x, j) => (j === i - 1 ? g : j === i ? groups[i - 1] : x)))} className="text-xs text-muted hover:text-ink" aria-label={`Move ${g} earlier`}>
                ‹
              </button>
            )}
            {g}
            {canEdit && (
              <button onClick={() => setList(groups.filter((x) => x !== g))} className="flex size-5 items-center justify-center rounded-full text-muted hover:bg-danger/10 hover:text-danger" aria-label={`Remove ${g}`}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add(text.split(","));
                }
              }}
              placeholder="Add a group, e.g. Children"
            />
            <Button variant="ghost" onClick={() => add(text.split(","))} disabled={!text.trim()}>
              Add
            </Button>
          </div>
          {groups.length === 0 && (
            <button onClick={() => add(["Children", "Youth", "Adults"])} className="text-xs text-muted hover:text-ink">
              + Start with Children, Youth, Adults
            </button>
          )}
          {missing.length > 0 && (
            <div className="text-xs text-muted">
              Already used by people:{" "}
              {missing.map((g) => (
                <button key={g} onClick={() => add([g])} className="mr-1.5 rounded-full border border-line px-2 py-0.5 hover:text-ink">
                  + {g}
                </button>
              ))}
            </div>
          )}
          {msg && <p className="text-xs text-muted">{msg}</p>}
        </div>
      )}
    </Card>
  );
}
