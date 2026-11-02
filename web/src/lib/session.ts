import "server-only";
import { cookies } from "next/headers";
import { hmac, safeEqual } from "./crypto";

export type Session =
  | { kind: "manager"; userId: string; email: string; exp: number }
  | { kind: "staff"; employeeId: string; storeId: string; exp: number }
  // A shared clock-in tablet: can only use that site's clock-in screen.
  | { kind: "kiosk"; storeId: string; startedBy: string; exp: number };

const COOKIE = "rota_session";
const MANAGER_TTL = 60 * 60 * 24 * 14; // 14 days
const STAFF_TTL = 60 * 60 * 24 * 60; // 60 days - staff log in on their own phones
const KIOSK_TTL = 60 * 60 * 24 * 30; // 30 days, then a manager starts it again

type NewSession = { kind: "manager"; userId: string; email: string } | { kind: "staff"; employeeId: string; storeId: string } | { kind: "kiosk"; storeId: string; startedBy: string };

export async function setSession(s: NewSession) {
  const ttl = s.kind === "manager" ? MANAGER_TTL : s.kind === "kiosk" ? KIOSK_TTL : STAFF_TTL;
  const body = Buffer.from(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + ttl })).toString("base64url");
  (await cookies()).set(COOKIE, `${body}.${hmac(body)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl,
  });
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > Date.now() / 1000 ? s : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}
