import "server-only";
import { db, isDemo } from "./db";
import { sendEmail } from "./email";
import type { Employee } from "./types";

/**
 * One way to reach a member of staff: email (always logged to the outbox), web push when
 * VAPID keys are set and they've allowed notifications, SMS when Twilio is configured and
 * they've opted in. Each channel fails quietly so one bad channel never blocks the action.
 */
export async function notify(storeId: string, person: Pick<Employee, "id" | "email" | "phone" | "notify" | "pushSubscriptions"> | null, subject: string, body: string, url = "/me") {
  if (!person) return;
  const prefs = person.notify ?? { email: true, sms: false, push: true };
  if (prefs.email || (!prefs.push && !prefs.sms)) await sendEmail(storeId, person.email ?? null, subject, body);
  if (prefs.push && person.pushSubscriptions?.length) await push(person, { title: subject, body: body.split("\n")[0].slice(0, 180), url });
  if (prefs.sms && person.phone) await sms(person.phone, `${subject}: ${body.split("\n")[0]}`.slice(0, 300));
}

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const smsConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

async function push(person: Pick<Employee, "id" | "pushSubscriptions">, payload: { title: string; body: string; url: string }) {
  if (!pushConfigured() || isDemo()) return;
  try {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:support@example.com", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
    const dead: string[] = [];
    for (const sub of person.pushSubscriptions ?? []) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(sub.endpoint); // unsubscribed / expired
        else console.error("push failed", code);
      }
    }
    if (dead.length) await (await db()).update("employees", person.id, { pushSubscriptions: (person.pushSubscriptions ?? []).filter((s) => !dead.includes(s.endpoint)) });
  } catch (e) {
    console.error("push unavailable", e);
  }
}

async function sms(to: string, text: string) {
  if (!smsConfigured() || isDemo()) return;
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: text }),
    });
    if (!res.ok) console.error("sms failed", res.status);
  } catch (e) {
    console.error("sms unavailable", e);
  }
}

/** Everyone who manages a site: email managers plus PIN staff with approval permissions get an email. */
export async function notifyManagers(storeId: string, subject: string, body: string) {
  for (const m of await (await db()).list("store_members", { storeId })) await sendEmail(storeId, m.email, subject, body);
}
