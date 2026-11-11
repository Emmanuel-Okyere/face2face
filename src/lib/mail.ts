import "server-only";
import type { NextRequest } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email over SMTP (Gmail, Workspace, or any provider).
 * Configured with SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM;
 * when they're missing, email features switch off and the app falls back to
 * temporary passwords.
 */
export function mailEnabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

let transport: Transporter | null = null;
function mailer() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 587 upgrades with STARTTLS
      requireTLS: port === 587,
      // Gmail shows app passwords as "abcd efgh ijkl mnop"; the spaces aren't part of it.
      auth: { user: process.env.SMTP_USER, pass: /gmail\.com$/i.test(process.env.SMTP_HOST || "") ? process.env.SMTP_PASS?.replace(/\s+/g, "") : process.env.SMTP_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transport;
}

/**
 * Where links in emails point. Never derived from the request's Host header in
 * production — a forged Host would otherwise put an attacker's domain in a
 * password-reset email.
 */
export function appOrigin(req: NextRequest) {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.NODE_ENV !== "production") return req.nextUrl.origin;
  throw new Error("Set APP_ORIGIN so email links point at the right address");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Mail = { to: string; subject: string; lines: string[]; button?: { label: string; url: string }; footer?: string };

function render({ subject, lines, button, footer }: Mail) {
  const text = [...lines, ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(footer ? ["", footer] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1d1b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="font-weight:600;font-size:15px;padding-bottom:20px">Face2Face</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${esc(subject)}</td></tr>
${lines.map((l) => `<tr><td style="font-size:15px;line-height:1.5;padding-bottom:8px">${esc(l)}</td></tr>`).join("")}
${button ? `<tr><td style="padding:16px 0 8px"><a href="${esc(button.url)}" style="display:inline-block;background:#1d1d1b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px">${esc(button.label)}</a></td></tr>` : ""}
${footer ? `<tr><td style="font-size:13px;color:#7a776f;line-height:1.5;padding-top:16px">${esc(footer)}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail(m: Mail) {
  if (!mailEnabled()) throw new Error("Email isn't set up");
  const { text, html } = render(m);
  await mailer().sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.to, subject: m.subject, text, html });
}

// ── Templates ────────────────────────────────────────────────────────────────

export const mails = {
  invite: (to: string, p: { name: string; by: string; org?: string; url: string; hours: number }) =>
    sendMail({
      to,
      subject: p.org ? `Join ${p.org} on Face2Face` : "You've been added to Face2Face",
      lines: [`Hi ${p.name},`, `${p.by} added you as an admin${p.org ? ` of ${p.org}` : ""}. Set a password to sign in.`],
      button: { label: "Set password", url: p.url },
      footer: `This link works once and expires in ${p.hours} hours.`,
    }),

  addedToOrg: (to: string, p: { name: string; by: string; org: string; url: string }) =>
    sendMail({
      to,
      subject: `You now have access to ${p.org}`,
      lines: [`Hi ${p.name},`, `${p.by} added you as an admin of ${p.org}. Sign in with your usual password.`],
      button: { label: "Sign in", url: p.url },
    }),

  reset: (to: string, p: { name: string; url: string; minutes: number }) =>
    sendMail({
      to,
      subject: "Reset your password",
      lines: [`Hi ${p.name},`, "Use the button below to choose a new password."],
      button: { label: "Reset password", url: p.url },
      footer: `This link works once and expires in ${p.minutes} minutes. If you didn't ask for this, ignore this email.`,
    }),

  passwordChanged: (to: string, p: { name: string; url: string }) =>
    sendMail({
      to,
      subject: "Your password was changed",
      lines: [`Hi ${p.name},`, "Your Face2Face password was just changed and other devices were signed out."],
      button: { label: "Not you? Reset it", url: p.url },
    }),
};
