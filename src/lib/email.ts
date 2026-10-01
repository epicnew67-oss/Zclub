/**
 * Brand-driven email templates + sender.
 *
 * Each template is a pure function returning `{to, subject, html, text}`
 * — no I/O. `sendEmail()` is the single transport entry point: it logs
 * to console by default, and POSTs to `EMAIL_WEBHOOK_URL` when set
 * (any HTTPS receiver — Resend, Postmark, SendGrid inbound webhook, a
 * tiny SMTP relay, etc.). The shape of the POST body matches Resend /
 * Postmark so a generic receiver works without code changes.
 *
 * Every template reads brand values from `lib/brand.ts` (dark
 * background, gold accent, burgundy button) — no hardcoded colors.
 *
 * Server-only: imported from server actions / RPC fan-out.
 */

import "server-only";
import { brand } from "@/lib/brand";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

type RenderedEmail = EmailPayload;

const FONT_STACK = `Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const DISPLAY_STACK = `"Playfair Display", Georgia, "Times New Roman", serif`;

/** Wrap a body block in the brand shell. */
function shell(previewText: string, bodyHtml: string): string {
  const c = brand.colors;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(brand.name)}</title></head>
<body style="margin:0;padding:0;background:${c.bg};color:${c.text};font-family:${FONT_STACK};font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(previewText)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg};padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${c.surface};border:1px solid ${c.line};border-radius:${brand.radius.lg};overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,${c.bg},${c.elevated});padding:24px 28px;border-bottom:1px solid ${c.line};text-align:center">
        <div style="font-family:${DISPLAY_STACK};font-size:28px;letter-spacing:6px;color:${c.gold};font-weight:700">${escapeHtml(brand.name.toUpperCase())}</div>
        <div style="margin-top:4px;font-size:12px;color:${c.textMuted};letter-spacing:2px;text-transform:uppercase">${escapeHtml(brand.domain)}</div>
      </td></tr>
      <tr><td style="padding:28px;color:${c.text}">${bodyHtml}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid ${c.line};background:${c.elevated};font-size:12px;color:${c.textMuted};text-align:center">
        Sent because you have an account on ${escapeHtml(brand.name)}. Manage email preferences in your account settings.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td style="background:${brand.colors.burgundy};border-radius:${brand.radius.md};padding:12px 22px"><a href="${escapeAttr(href)}" style="color:${brand.colors.text};text-decoration:none;font-weight:600;letter-spacing:0.4px">${escapeHtml(label)}</a></td></tr></table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? `https://${brand.domain}`;
}

function link(href: string): string {
  return `${baseUrl()}${href.startsWith("/") ? href : `/${href}`}`;
}

// ============================================================ templates

export function renderBookingCreatedEmail(input: {
  toEmail: string;
  counterpartyName: string;
  listingTitle: string;
  startsAt: Date;
  bookingId: string;
}): RenderedEmail {
  const { toEmail, counterpartyName, listingTitle, startsAt, bookingId } = input;
  const when = formatWhen(startsAt);
  const html = shell(
    `New booking on ${listingTitle}`,
    `<h1 style="margin:0 0 8px;font-family:${DISPLAY_STACK};font-size:24px;color:${brand.colors.gold}">New booking confirmed</h1>
     <p style="margin:0 0 12px">Your 1:1 video call with <strong>${escapeHtml(counterpartyName)}</strong> is booked for <strong>${escapeHtml(when)}</strong>.</p>
     <p style="margin:0 0 8px;color:${brand.colors.textMuted}">Listing: ${escapeHtml(listingTitle)}</p>
     ${button(link(`/orders/${bookingId}`), "Open the order")}`
  );
  return {
    to: toEmail,
    subject: `${brand.name} — booking confirmed for ${when}`,
    html,
    text: `New booking confirmed with ${counterpartyName} for ${when}. Open: ${link(`/orders/${bookingId}`)}`,
  };
}

export function renderCallStartsIn15Email(input: {
  toEmail: string;
  counterpartyName: string;
  listingTitle: string;
  startsAt: Date;
  bookingId: string;
}): RenderedEmail {
  const { toEmail, counterpartyName, listingTitle, startsAt, bookingId } = input;
  const when = formatWhen(startsAt);
  const html = shell(
    `Your call with ${counterpartyName} starts in 15 minutes`,
    `<h1 style="margin:0 0 8px;font-family:${DISPLAY_STACK};font-size:24px;color:${brand.colors.gold}">Starts in 15 minutes</h1>
     <p style="margin:0 0 12px">Your call with <strong>${escapeHtml(counterpartyName)}</strong> for <strong>${escapeHtml(listingTitle)}</strong> starts at ${escapeHtml(when)}.</p>
     ${button(link(`/orders/${bookingId}`), "Open the order")}`
  );
  return {
    to: toEmail,
    subject: `${brand.name} — your call starts at ${when}`,
    html,
    text: `Your call with ${counterpartyName} starts in 15 minutes (${when}). Open: ${link(`/orders/${bookingId}`)}`,
  };
}

export function renderSellerJoinedEmail(input: {
  toEmail: string;
  counterpartyName: string;
  bookingId: string;
}): RenderedEmail {
  const { toEmail, counterpartyName, bookingId } = input;
  const html = shell(
    `${counterpartyName} just joined the call`,
    `<h1 style="margin:0 0 8px;font-family:${DISPLAY_STACK};font-size:24px;color:${brand.colors.gold}">${escapeHtml(counterpartyName)} joined</h1>
     <p style="margin:0 0 12px">Your counterparty is in the call room. You can join now.</p>
     ${button(link(`/orders/${bookingId}`), "Join the call")}`
  );
  return {
    to: toEmail,
    subject: `${brand.name} — ${counterpartyName} joined the call`,
    html,
    text: `${counterpartyName} just joined the call. Open: ${link(`/orders/${bookingId}`)}`,
  };
}

export function renderPaymentCreditedEmail(input: {
  toEmail: string;
  tokens: number;
  source: string;
}): RenderedEmail {
  const { toEmail, tokens, source } = input;
  const formatted = tokens.toLocaleString();
  const html = shell(
    `${formatted} tokens added to your wallet`,
    `<h1 style="margin:0 0 8px;font-family:${DISPLAY_STACK};font-size:24px;color:${brand.colors.gold}">+${escapeHtml(formatted)} tokens</h1>
     <p style="margin:0 0 12px">${escapeHtml(formatted)} tokens were credited to your wallet via <strong>${escapeHtml(source)}</strong>.</p>
     ${button(link("/wallet"), "Open the wallet")}`
  );
  return {
    to: toEmail,
    subject: `${brand.name} — ${formatted} tokens credited`,
    html,
    text: `${formatted} tokens credited via ${source}. Wallet: ${link("/wallet")}`,
  };
}

export function renderApplicationResultEmail(input: {
  toEmail: string;
  approved: boolean;
  reason: string | null;
}): RenderedEmail {
  const { toEmail, approved, reason } = input;
  const headline = approved ? "You're approved" : "Update on your application";
  const body = approved
    ? `<p style="margin:0 0 12px">Welcome — your seller profile is live. Set up your listings to start selling.</p>
       ${button(link("/seller"), "Open the seller dashboard")}`
    : `<p style="margin:0 0 12px">Your seller application was not approved at this time.</p>
       ${reason ? `<blockquote style="margin:12px 0;padding:12px;border-left:3px solid ${brand.colors.burgundy};background:${brand.colors.elevated};color:${brand.colors.textMuted}">${escapeHtml(reason)}</blockquote>` : ""}
       ${button(link("/become-a-seller"), "View the application form")}`;
  const html = shell(`${brand.name} seller application ${approved ? "approved" : "declined"}`, `<h1 style="margin:0 0 8px;font-family:${DISPLAY_STACK};font-size:24px;color:${brand.colors.gold}">${escapeHtml(headline)}</h1>${body}`);
  return {
    to: toEmail,
    subject: `${brand.name} — seller application ${approved ? "approved" : "update"}`,
    html,
    text: `${headline}. ${reason ?? ""}`,
  };
}

// ============================================================ sender

export type SendResult = { ok: true; mode: "logged" | "webhook" } | { ok: false; error: string };

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: `${brand.name} <no-reply@${brand.domain}>`,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        }),
      });
      if (!res.ok) return { ok: false, error: `webhook ${res.status}` };
      return { ok: true, mode: "webhook" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "send failed" };
    }
  }
  // Fallback: log to console so dev flows work without a configured transport.
  console.log(
    `[email] to=${payload.to} subject=${JSON.stringify(payload.subject)} mode=logged (set EMAIL_WEBHOOK_URL to actually send)`
  );
  return { ok: true, mode: "logged" };
}

// ============================================================ helpers

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
