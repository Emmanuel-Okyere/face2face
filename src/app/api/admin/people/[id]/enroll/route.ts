import { z } from "zod";
import { clearAvatar, decodeJpegDataUrl, saveAvatar } from "@/lib/avatars";
import { config } from "@/lib/config";
import { toVector } from "@/lib/db";
import { body, descriptorSchema, handle, HttpError, json, requireOrg } from "@/lib/http";
import { tenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  samples: z
    .array(z.object({ descriptor: descriptorSchema, quality: z.number().min(0).max(1), pose: z.string().max(20) }))
    .min(3, "At least 3 photos are required")
    .max(5, "At most 5 photos per person"),
  avatar: z.string().max(45_000).optional(), // data:image/jpeg;base64,… thumbnail
  consent: z.literal(true, { message: "Consent is required to store face data" }),
  force: z.boolean().optional(),
});

function dist(a: number[], b: number[]) {
  return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
}

export const POST = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  const { samples, avatar, force } = await body(req, schema);
  const jpeg = avatar ? decodeJpegDataUrl(avatar) : null; // validate before touching anything

  // 1. Internal consistency — every shot should look like the same person.
  const centroid = samples[0].descriptor.map((_, i) => samples.reduce((s, x) => s + x.descriptor[i], 0) / samples.length);
  const outliers = samples.map((s, i) => ({ i, d: dist(s.descriptor, centroid) })).filter((x) => x.d > 0.45);
  if (outliers.length) {
    throw new HttpError(
      422,
      `Photo${outliers.length > 1 ? "s" : ""} ${outliers.map((o) => o.i + 1).join(", ")} don't look like the others — retake ${outliers.length > 1 ? "them" : "it"}.`,
    );
  }

  return tenant(org.id, async (sql) => {
    const [person] = await sql`select id from people where id = ${id}`;
    if (!person) throw new HttpError(404, "Person not found");

    // 2. Duplicate guard — is this face already enrolled under someone else in this org?
    if (!force) {
      const [dup] = await sql`
        select p.id, p.ref, coalesce(p.code, p.ref) as code, p.full_name, p.avatar_url as avatar, min(e.embedding <-> ${toVector(centroid)}::vector)::float8 as distance
        from face_embeddings e join people p on p.id = e.person_id
        where e.org_id = ${org.id} and e.person_id <> ${id}
        group by p.id
        order by distance limit 1`;
      if (dup && dup.distance < config.duplicateThreshold) {
        return json({ error: "possible_duplicate", duplicate: dup }, 409);
      }
    }

    // 3. Replace this person's templates (same transaction → atomic).
    await sql`delete from face_embeddings where person_id = ${id}`;
    for (const s of samples) {
      await sql`
        insert into face_embeddings (org_id, person_id, embedding, quality, pose)
        values (${org.id}, ${id}, ${toVector(s.descriptor)}::vector, ${s.quality}, ${s.pose})`;
    }
    await sql`update people set consent_at = now(), updated_at = now() where id = ${id}`;

    // 4. Thumbnail → private Blob (or bytea). A failed upload keeps the enrollment.
    let avatarSaved = true;
    if (jpeg) {
      try {
        await sql.savepoint((sp) => saveAvatar(sp, id, jpeg));
      } catch (e) {
        console.error("[enroll] avatar save failed", e);
        avatarSaved = false;
      }
    }
    return json({ ok: true, count: samples.length, avatarSaved });
  });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { org } = await requireOrg(req);
  const id = z.uuid().parse((await params).id);
  await tenant(org.id, async (sql) => {
    await sql`delete from face_embeddings where person_id = ${id}`;
    await clearAvatar(sql, id); // the thumbnail is biometric too
  });
  return json({ ok: true });
});
