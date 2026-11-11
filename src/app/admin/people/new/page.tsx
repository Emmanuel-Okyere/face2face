"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/AdminShell";
import { useOrgFields } from "@/components/FieldsEditor";
import { PersonFieldsForm, type FormValues } from "@/components/PersonFields";
import { api, Button, Card, Spinner } from "@/components/ui";

export default function NewPerson() {
  const router = useRouter();
  const fields = useOrgFields();
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setErrors({});
    try {
      const r = await api<{ person: { id: string } }>("/api/admin/people", { method: "POST", json: values });
      router.push(`/admin/people/${r.person.id}?enroll=1`);
    } catch (e) {
      const fe = (e as { data?: { fieldErrors?: Record<string, string> } }).data?.fieldErrors;
      if (fe) setErrors(fe);
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Add a person" />
      <Card>
        {!fields ? (
          <Spinner />
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <PersonFieldsForm fields={fields} values={values} onChange={setValues} errors={errors} autoFocus />
            {err && !Object.keys(errors).length && <p className="text-sm text-danger">{err}</p>}
            <div className="flex items-center justify-between gap-2">
              <span />
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button type="submit" loading={busy}>
                  Continue to face enrollment →
                </Button>
              </div>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
