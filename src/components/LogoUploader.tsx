"use client";

import { useRef, useState } from "react";
import { api, Button, cx, OrgLogo } from "@/components/ui";

const MAX_SIDE = 512;
const MAX_BYTES = 280 * 1024;

/** Shrink to ≤512 px in the browser, keeping transparency; PNG first, WebP if PNG is too big. */
async function prepare(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error(
      file.type === "image/svg+xml" ? "SVG isn't supported — export your logo as PNG instead." : "Choose a PNG, JPEG or WebP image.",
    );
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is over 10 MB.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  let blob = await toBlob("image/png");
  if (!blob || blob.size > MAX_BYTES) blob = await toBlob("image/webp", 0.9);
  if (!blob || blob.size > MAX_BYTES || blob.type === "image/png") {
    // WebP unsupported or still big: JPEG on white (drops transparency, always small).
    const j = document.createElement("canvas");
    j.width = c.width;
    j.height = c.height;
    const jc = j.getContext("2d")!;
    jc.fillStyle = "#fff";
    jc.fillRect(0, 0, j.width, j.height);
    jc.drawImage(c, 0, 0);
    blob = await new Promise<Blob | null>((r) => j.toBlob(r, "image/jpeg", 0.88));
  }
  if (!blob || blob.size > MAX_BYTES) throw new Error("Couldn't make this image small enough — try a simpler logo.");
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Couldn't read the image"));
    fr.readAsDataURL(blob);
  });
}

export default function LogoUploader({
  name,
  logoUrl,
  canEdit,
  onChange,
}: {
  name: string;
  logoUrl: string | null;
  canEdit: boolean;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);

  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const dataUrl = await prepare(file);
      const r = await api<{ logoUrl: string | null }>("/api/admin/org/logo", { method: "PUT", json: { dataUrl } });
      onChange(r.logoUrl);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    if (!confirm("Remove your logo and go back to the default?")) return;
    setBusy(true);
    await api("/api/admin/org/logo", { method: "DELETE" });
    onChange(null);
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Preview on light and dark, the two backgrounds it appears on */}
      <div className="flex overflow-hidden rounded-2xl border border-line">
        <div className="flex size-20 items-center justify-center bg-white">
          <OrgLogo src={logoUrl} name={name} size={56} />
        </div>
        <div className="flex size-20 items-center justify-center bg-[#2b2d2f]">
          <OrgLogo src={logoUrl} name={name} size={56} />
        </div>
      </div>
      {canEdit ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            upload(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "min-w-0 flex-1 rounded-2xl border border-dashed px-4 py-3 text-sm transition",
            drag ? "border-good bg-good-soft/30" : "border-line",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" loading={busy} onClick={() => input.current?.click()}>
              {logoUrl ? "Replace logo" : "Upload logo"}
            </Button>
            {logoUrl && (
              <Button variant="subtle" onClick={remove} disabled={busy}>
                Use default
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted">PNG, JPEG or WebP</p>
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => upload(e.target.files?.[0])}
          />
        </div>
      ) : null}
    </div>
  );
}
