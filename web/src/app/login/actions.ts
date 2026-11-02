"use server";

import { limit } from "@/lib/rate-limit";
import { redirect } from "next/navigation";
import { pinHash } from "@/lib/crypto";
import { db, isDemo } from "@/lib/db";
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

// ---------------------------------------------------------------- manager: Supabase email OTP / magic link

export async function managerEmailLogin(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  if (isDemo()) return { error: "Email sign-in needs Supabase. In demo mode, use “Enter as manager”." };
  if (!limit("emailLogin", email).ok) return { error: "Too many sign-in emails. Wait 15 minutes and try again." };
  const { authClient } = await import("@/lib/db/supabase");
  const site = process.env.SITE_URL ?? "http://localhost:3000";
  const { error } = await authClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${site}/auth/callback` } });
  if (error) return { error: error.message };
  return { step: "code", email, info: "Check your email for a sign-in link or a 6-digit code." };
}

export async function verifyEmailCode(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").trim();
  const { authClient } = await import("@/lib/db/supabase");
  const { data, error } = await authClient().auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) return { step: "code", email, error: error?.message ?? "That code didn't work." };
  await claimInvites(data.user.id, data.user.email ?? email);
  await setSession({ kind: "manager", userId: data.user.id, email: data.user.email ?? email });
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
