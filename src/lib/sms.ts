import "server-only";

/**
 * SMS through GIANT SMS (giantsms.com, Ghana).
 *   POST https://api.giantsms.com/api/v1/send   form fields: from, to, msg
 *   Auth: "Authorization: Basic <token>" (API token from the dashboard), or
 *         HTTP Basic with the account username + password.
 *   Response: { status: true|false, message, data }
 */
const API = () => (process.env.GIANTSMS_API_URL || "https://api.giantsms.com/api/v1").replace(/\/$/, "");

export function smsEnabled() {
  const e = process.env;
  return !!e.GIANTSMS_SENDER_ID && (!!e.GIANTSMS_TOKEN || !!(e.GIANTSMS_USERNAME && e.GIANTSMS_PASSWORD));
}

function auth() {
  const e = process.env;
  if (e.GIANTSMS_TOKEN) return `Basic ${e.GIANTSMS_TOKEN}`;
  return `Basic ${Buffer.from(`${e.GIANTSMS_USERNAME}:${e.GIANTSMS_PASSWORD}`).toString("base64")}`;
}

export type SmsResult = { ok: true; id?: string } | { ok: false; error: string; retry: boolean };

/** Send one SMS. `to` is E.164 (+233…); GIANT SMS wants it without the "+". */
export async function sendSms(to: string, text: string): Promise<SmsResult> {
  if (!smsEnabled()) return { ok: false, error: "SMS isn't set up", retry: false };
  try {
    const res = await fetch(`${API()}/send`, {
      method: "POST",
      headers: { Authorization: auth(), Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ from: process.env.GIANTSMS_SENDER_ID!, to: to.replace(/^\+/, ""), msg: text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { status?: unknown; message?: string; data?: { message_id?: string } } | null;
    if (res.ok && (body?.status === true || body?.status === "true")) return { ok: true, id: body?.data?.message_id };
    const error = (body?.message || `HTTP ${res.status}`).slice(0, 300);
    // 4xx = our request is wrong (bad number, no credit, bad sender) → don't hammer; 5xx/network → retry.
    return { ok: false, error, retry: res.status >= 500 };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300), retry: true };
  }
}
