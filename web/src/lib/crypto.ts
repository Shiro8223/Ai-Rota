import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "demo-only-secret-change-me-in-production";

export function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.SUPABASE_URL) throw new Error("SESSION_SECRET (32+ chars) must be set in production");
  return DEV_SECRET;
}

export const hmac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PINs are keyed by store so they can be looked up (and kept unique) without storing them. */
export const pinHash = (storeId: string, pin: string) => hmac(`pin:${storeId}:${pin}`);
