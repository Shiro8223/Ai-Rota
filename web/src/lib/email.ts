import "server-only";
import { db, isDemo, newId, now } from "./db";
import { loadStore } from "./org";
import { hasFeature } from "./roles";

/**
 * Account emails (sign-in codes): not tied to a store, never kept in the outbox. Without
 * RESEND_API_KEY it only works in demo mode, where the code is printed to the server log.
 */
export async function sendSystemEmail(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    if (isDemo()) {
      console.info(`[email to ${to}] ${subject}`);
      return { ok: true };
    }
    return { ok: false, error: "Email isn't set up on this server (RESEND_API_KEY)." };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Rota <rota@example.com>", to, subject, text: body }),
  });
  if (!res.ok) console.error("email failed", res.status, await res.text());
  return res.ok ? { ok: true } : { ok: false, error: "We couldn't send the email. Try again in a minute." };
}

/**
 * Sends through Resend when RESEND_API_KEY is set. Every message is also written to the
 * outbox table, which is what the demo's /outbox page shows.
 */
export async function sendEmail(storeId: string, to: string | null, subject: string, body: string) {
  // "Email notifications" switched off by the Account Primary: in-app only.
  const store = await loadStore(storeId);
  if (store && !hasFeature(store.features, "emails")) return;
  let sent = false;
  if (to && process.env.RESEND_API_KEY && !isDemo()) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? "Rota <rota@example.com>", to, subject, text: body }),
    });
    sent = res.ok;
    if (!res.ok) console.error("email failed", res.status, await res.text());
  }
  await (await db()).insert("emails", { id: newId(), storeId, to: to ?? "(no email on file)", subject, body, sent, at: now() });
}
