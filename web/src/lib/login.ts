import "server-only";
import { randomInt } from "node:crypto";
import { hmac, safeEqual } from "./crypto";
import { db, newId, now } from "./db";
import { sendSystemEmail } from "./email";
import type { User } from "./types";

const TTL_MIN = 10;
const MAX_TRIES = 5;
const hashCode = (email: string, code: string) => hmac(`login:${email}:${code}`);
export const normalEmail = (e: string) => e.trim().toLowerCase();

/** Email a 6-digit sign-in code. Only its HMAC is stored; it lasts 10 minutes. */
export async function requestLoginCode(rawEmail: string) {
  const email = normalEmail(rawEmail);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const d = await db();
  // A new code replaces any earlier unused one.
  for (const c of await d.list("login_codes", { email, usedAt: null })) await d.update("login_codes", c.id, { usedAt: now() });
  await d.insert("login_codes", { id: newId(), email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + TTL_MIN * 60_000).toISOString(), attempts: 0, usedAt: null, createdAt: now() });
  return sendSystemEmail(email, `${code} is your Rota Agent sign-in code`, `Your sign-in code is ${code}\n\nIt works for ${TTL_MIN} minutes. If you didn't ask for it, you can ignore this email.`);
}

/** Check a code; on success returns the user (created on first sign-in). */
export async function verifyLoginCode(rawEmail: string, rawCode: string): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  const email = normalEmail(rawEmail);
  const code = rawCode.replace(/\D/g, "");
  const d = await db();
  const [c] = (await d.list("login_codes", { email, usedAt: null }, { orderBy: "createdAt", desc: true, limit: 1 }));
  if (!c || c.expiresAt < now()) return { ok: false, error: "That code has expired. Ask for a new one." };
  if (c.attempts >= MAX_TRIES) return { ok: false, error: "Too many wrong codes. Ask for a new one." };
  if (code.length !== 6 || !safeEqual(c.codeHash, hashCode(email, code))) {
    await d.update("login_codes", c.id, { attempts: c.attempts + 1 });
    return { ok: false, error: "That code didn't work." };
  }
  await d.update("login_codes", c.id, { usedAt: now() });
  const [existing] = await d.list("users", { email });
  const user = existing ? await d.update("users", existing.id, { lastLoginAt: now() }) : await d.insert("users", { id: newId(), email, createdAt: now(), lastLoginAt: now() });
  return { ok: true, user };
}

/** Daily tidy-up: codes older than a day. */
export async function purgeLoginCodes() {
  const d = await db();
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  let n = 0;
  for (const c of await d.list("login_codes")) {
    if (c.createdAt < cutoff) {
      await d.remove("login_codes", { id: c.id });
      n++;
    }
  }
  return n;
}
