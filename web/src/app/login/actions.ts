"use server";

import { limit } from "@/lib/rate-limit";
import { redirect } from "next/navigation";
import { pinHash } from "@/lib/crypto";
import { db, dbKind, isDemo } from "@/lib/db";
import { requestLoginCode, verifyLoginCode } from "@/lib/login";
import { DEMO_MANAGER, DEMO_ORG_ID } from "@/lib/seed";
import { clearSession, setSession } from "@/lib/session";
import { claimInvites } from "@/lib/team";

export type FormState = { error?: string; info?: string; step?: "code"; email?: string } | undefined;

export async function demoManagerLogin() {
  if (!isDemo()) redirect("/login");
  await setSession({ kind: "manager", userId: DEMO_MANAGER.id, email: DEMO_MANAGER.email });
  redirect(`/org/${DEMO_ORG_ID}`);
}

export async function demoStaffLogin(employeeId: string) {
  if (!isDemo()) redirect("/login");
  const e = await (await db()).get("employees", employeeId);
  if (!e) redirect("/login");
  await setSession({ kind: "staff", employeeId: e.id, storeId: e.storeId });
  redirect("/me");
}

// ---------------------------------------------------------------- manager: one-time email code

export async function managerEmailLogin(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  if (dbKind() === "file") return { error: "Email sign-in needs a database. In the demo, use “Enter as manager”." };
  if (!limit("emailLogin", email).ok) return { error: "Too many sign-in emails. Wait 15 minutes and try again." };
  const r = await requestLoginCode(email);
  if (!r.ok) return { error: r.error };
  return { step: "code", email, info: isDemo() && !process.env.RESEND_API_KEY ? "Demo: the code is in the server log." : "Check your email for a 6-digit code." };
}

export async function verifyEmailCode(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const r = await verifyLoginCode(email, String(form.get("code") ?? ""));
  if (!r.ok) return { step: "code", email, error: r.error };
  await claimInvites(r.user.id, r.user.email);
  await setSession({ kind: "manager", userId: r.user.id, email: r.user.email });
  redirect("/stores");
}

// ---------------------------------------------------------------- staff: store join code + PIN

const attempts = new Map<string, { n: number; until: number }>();

export async function staffLogin(_: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("joinCode") ?? "").trim().toUpperCase();
  const pin = String(form.get("pin") ?? "").trim();
  const key = `join:${code}`;
  const a = attempts.get(key);
  if (a && a.n >= 8 && a.until > Date.now()) return { error: "Too many attempts. Wait 10 minutes and try again." };

  const d = await db();
  const [store] = await d.list("stores", { joinCode: code });
  const employee = store && /^\d{4,6}$/.test(pin) ? (await d.list("employees", { storeId: store.id, pinHash: pinHash(store.id, pin), active: true }))[0] : undefined;
  if (!store || !employee) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60_000 });
    return { error: "That store code and PIN don't match. Ask your manager for your PIN." };
  }
  attempts.delete(key);
  await setSession({ kind: "staff", employeeId: employee.id, storeId: store.id });
  redirect("/me");
}

export async function logout() {
  await clearSession();
  redirect("/login");
}
