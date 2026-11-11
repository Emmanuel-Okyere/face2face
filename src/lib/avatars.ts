import "server-only";
import { del, get, put } from "@vercel/blob";
import { HttpError } from "./http";
import type { Tx } from "./tenant";

/**
 * Face thumbnails (≈5 KB, 112×112 JPEG) for the admin UI and kiosk greeting.
 *
 * Storage: a PRIVATE Vercel Blob store when configured (BLOB_READ_WRITE_TOKEN, or
 * BLOB_STORE_ID with Vercel OIDC); otherwise a bytea column. Blob URLs are never
 * sent to browsers — images are streamed through /api/avatars/:id after an
 * admin/kiosk auth check, so a leaked link or log line exposes nothing.
 */
export const blobEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const MAX_BYTES = 30 * 1024;

/** Decode and validate a `data:image/jpeg;base64,…` thumbnail from the client. */
export function decodeJpegDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "Avatar must be a base64 JPEG data URL");
  const buf = Buffer.from(m[1], "base64");
  // Check the bytes really are a JPEG (SOI marker), not just the label.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new HttpError(400, "Avatar is not a JPEG");
  if (buf.length > MAX_BYTES) throw new HttpError(413, "Avatar too large");
  return buf;
}

/** All functions take a tenant transaction, so they only ever see the org's people. */
export async function saveAvatar(sql: Tx, personId: string, jpeg: Buffer) {
  const [prev] = await sql`select avatar_key from people where id = ${personId}`;
  if (!prev) throw new HttpError(404, "Person not found");

  if (blobEnabled()) {
    // Random suffix → unguessable pathname, and a fresh object per version.
    const { pathname } = await put(`avatars/${personId}.jpg`, jpeg, {
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: true,
    });
    await sql`
      update people set avatar_key = ${pathname}, avatar_bytes = null,
        avatar_version = avatar_version + 1, updated_at = now()
      where id = ${personId}`;
  } else {
    await sql`
      update people set avatar_bytes = ${jpeg}, avatar_key = null,
        avatar_version = avatar_version + 1, updated_at = now()
      where id = ${personId}`;
  }
  if (prev.avatar_key) await removeBlobs([prev.avatar_key]);
}

/** Remove a person's thumbnail (e.g. when their face data is deleted). */
export async function clearAvatar(sql: Tx, personId: string) {
  const [row] = await sql`
    update people p set avatar_key = null, avatar_bytes = null, avatar_version = 0, updated_at = now()
    from (select id, avatar_key from people where id = ${personId} for update) old
    where p.id = old.id
    returning old.avatar_key`;
  if (row?.avatar_key) await removeBlobs([row.avatar_key]);
}

/** Best-effort blob cleanup; a stray orphan is harmless (private, unreferenced). */
export async function removeBlobs(keys: string[]) {
  const list = keys.filter(Boolean);
  if (!list.length || !blobEnabled()) return;
  try {
    await del(list);
  } catch (e) {
    console.error("[avatars] blob delete failed", e);
  }
}

export async function readAvatar(sql: Tx, personId: string): Promise<{ body: ReadableStream<Uint8Array> | Uint8Array; etag: string } | null> {
  const [row] = await sql`
    select avatar_key, avatar_bytes, avatar_version from people where id = ${personId} and avatar_version > 0`;
  if (!row) return null;
  const etag = `"${personId}-${row.avatar_version}"`;
  if (row.avatar_key) {
    const r = await get(row.avatar_key, { access: "private" });
    if (!r || r.statusCode !== 200) return null;
    return { body: r.stream, etag };
  }
  if (row.avatar_bytes) return { body: new Uint8Array(row.avatar_bytes), etag };
  return null;
}
