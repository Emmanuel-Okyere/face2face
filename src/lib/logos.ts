import "server-only";
import { del, get, put } from "@vercel/blob";
import { blobEnabled } from "./avatars";
import { db } from "./db";
import { HttpError } from "./http";

export const LOGO_MAX_BYTES = 300 * 1024;
type LogoType = "image/png" | "image/jpeg" | "image/webp";

/**
 * Decode a `data:image/...;base64,` logo and check its real file signature.
 * SVG is refused on purpose: it can carry scripts. The browser already
 * rasterises and shrinks uploads to ≤512 px before sending.
 */
export function decodeLogo(dataUrl: string): { bytes: Buffer; type: LogoType } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "Logo must be a PNG, JPEG or WebP image");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > LOGO_MAX_BYTES) throw new HttpError(413, "Logo is too large (max 300 KB)");
  const b = bytes;
  const isPng = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isWebp = b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
  const type: LogoType | null = isPng ? "image/png" : isJpeg ? "image/jpeg" : isWebp ? "image/webp" : null;
  if (!type) throw new HttpError(400, "That file isn't a PNG, JPEG or WebP image");
  return { bytes, type };
}

export async function saveLogo(orgId: string, logo: { bytes: Buffer; type: LogoType }) {
  const sql = db();
  const [prev] = await sql`select logo_key from organizations where id = ${orgId}`;
  if (blobEnabled()) {
    const ext = logo.type.split("/")[1];
    const { pathname } = await put(`logos/${orgId}.${ext}`, logo.bytes, {
      access: "private",
      contentType: logo.type,
      addRandomSuffix: true,
    });
    await sql`
      update organizations set logo_key = ${pathname}, logo_bytes = null, logo_type = ${logo.type},
        logo_version = logo_version + 1
      where id = ${orgId}`;
  } else {
    await sql`
      update organizations set logo_bytes = ${logo.bytes}, logo_key = null, logo_type = ${logo.type},
        logo_version = logo_version + 1
      where id = ${orgId}`;
  }
  if (prev?.logo_key) await removeLogoBlob(prev.logo_key);
}

/** Back to the default Face2Face mark. */
export async function clearLogo(orgId: string) {
  const [prev] = await db()`select logo_key from organizations where id = ${orgId}`;
  await db()`
    update organizations set logo_key = null, logo_bytes = null, logo_type = null, logo_version = 0
    where id = ${orgId}`;
  if (prev?.logo_key) await removeLogoBlob(prev.logo_key);
}

async function removeLogoBlob(key: string) {
  if (!blobEnabled()) return;
  try {
    await del(key);
  } catch (e) {
    console.error("[logos] blob delete failed", e);
  }
}

export async function readLogo(orgId: string): Promise<{ body: Uint8Array; type: string; etag: string } | null> {
  const [row] = await db()`
    select logo_key, logo_bytes, logo_type, logo_version from organizations where id = ${orgId} and logo_version > 0`;
  if (!row) return null;
  const etag = `"logo-${orgId}-${row.logo_version}"`;
  if (row.logo_key) {
    const r = await get(row.logo_key, { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return { body: new Uint8Array(await new Response(r.stream).arrayBuffer()), type: row.logo_type, etag };
  }
  return row.logo_bytes ? { body: new Uint8Array(row.logo_bytes), type: row.logo_type, etag } : null;
}
