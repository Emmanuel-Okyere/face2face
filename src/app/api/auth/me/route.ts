import { getAdmin } from "@/lib/auth";
import { handle, json } from "@/lib/http";

export const GET = handle(async (req) => {
  const a = await getAdmin(req);
  return json({ admin: a ? { id: a.id, email: a.email, name: a.name } : null });
});
