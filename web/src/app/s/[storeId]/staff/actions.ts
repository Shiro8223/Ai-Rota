"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { can, requireStore, type Access } from "@/lib/auth";
import { orgStores } from "@/lib/org";
import { setEmployeeRoles, storeRoles } from "@/lib/team";
import { pinHash } from "@/lib/crypto";
import { db } from "@/lib/db";
import { addTemporaryAvailability, createEmployee, EmployeeInput, freshPin, setUsualAvailability, TempInput, WeekSchema } from "@/lib/staff";
import type { WeekWindows } from "@/lib/types";

export type StaffFormState = { error?: string; pin?: string; name?: string; ok?: boolean } | undefined;

function readForm(form: FormData) {
  return EmployeeInput.safeParse({
    name: form.get("name"),
    startDate: form.get("startDate"),
    contractedHours: form.get("contractedHours"),
    maxHoursPerWeek: form.get("maxHoursPerWeek"),
    email: String(form.get("email") ?? "").trim(),
    roleIds: form.getAll("roleIds").map(String),
  });
}

/**
 * Access roles carry permissions, so only people who may manage roles can grant or remove
 * them. Everyone else's submission keeps the person's existing access roles unchanged.
 */
async function guardAccessRoles(storeId: string, access: Access, wanted: string[], current: string[]) {
  if (can(access, "account.admin")) return wanted;
  const roles = await storeRoles(storeId);
  const isAccess = (id: string) => roles.find((r) => r.id === id)?.category === "access";
  return [...wanted.filter((id) => !isAccess(id)), ...current.filter(isAccess)];
}

async function ownEmployee(storeId: string, employeeId: string) {
  const e = await (await db()).get("employees", employeeId);
  return e && e.storeId === storeId ? e : null;
}

export async function addEmployee(storeId: string, _: StaffFormState, form: FormData): Promise<StaffFormState> {
  const access = await requireStore(storeId, "staff.manage");
  const parsed = readForm(form);
  if (!parsed.success) return { error: z.prettifyError(parsed.error) };
  const roleIds = await guardAccessRoles(storeId, access, parsed.data.roleIds, []);
  const { employee, pin } = await createEmployee(storeId, { ...parsed.data, roleIds });
  const actor = access.actor;
  await audit(storeId, actor, "employee.created", { employeeId: employee.id, name: employee.name });
  revalidatePath(`/s/${storeId}/staff`);
  return { ok: true, pin, name: employee.name };
}

export async function updateEmployee(storeId: string, employeeId: string, _: StaffFormState, form: FormData): Promise<StaffFormState> {
  const access = await requireStore(storeId, "staff.manage");
  const current = await ownEmployee(storeId, employeeId);
  if (!current) return { error: "Not found" };
  const parsed = readForm(form);
  if (!parsed.success) return { error: z.prettifyError(parsed.error) };
  const { roleIds: wanted, ...details } = parsed.data;
  const roleIds = await guardAccessRoles(storeId, access, wanted, current.roleIds ?? []);
  await (await db()).update("employees", employeeId, details);
  await setEmployeeRoles(storeId, employeeId, roleIds);
  await audit(storeId, access.actor, "employee.updated", { employeeId, name: details.name, roleIds });
  revalidatePath(`/s/${storeId}/staff`);
  return { ok: true };
}

export async function resetPin(storeId: string, employeeId: string): Promise<StaffFormState> {
  const { actor } = await requireStore(storeId, "staff.manage");
  const e = await ownEmployee(storeId, employeeId);
  if (!e) return { error: "Not found" };
  const pin = await freshPin(storeId);
  await (await db()).update("employees", employeeId, { pinHash: pinHash(storeId, pin) });
  await audit(storeId, actor, "employee.pin_reset", { employeeId });
  return { ok: true, pin, name: e.name };
}

const AGE = ["21+", "18-20", "16-17", "apprentice"] as const;
const dateOrNull = (v: FormDataEntryValue | null) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Pay (needs the pay permission), minimum-wage band, right to work, opt-out, qualifications, contact. */
export async function saveCompliance(storeId: string, employeeId: string, _: { ok?: boolean; error?: string } | undefined, form: FormData) {
  const access = await requireStore(storeId, "staff.manage");
  const e = await ownEmployee(storeId, employeeId);
  if (!e) return { error: "Not found" };
  const band = String(form.get("ageBand") ?? "");
  const rateRaw = String(form.get("hourlyRate") ?? "").trim();
  const rate = rateRaw === "" ? null : Number(rateRaw);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 500)) return { error: "Hourly pay must be a number of pounds." };
  const phone = String(form.get("phone") ?? "").trim();
  if (phone && !/^\+?[0-9 ]{7,16}$/.test(phone)) return { error: "Enter the mobile number in international format, e.g. +447700900123." };
  const qualificationExpiry: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("qual:") && dateOrNull(v)) qualificationExpiry[k.slice(5)] = String(v);
  const patch = {
    ageBand: (AGE as readonly string[]).includes(band) ? (band as (typeof AGE)[number]) : null,
    rightToWorkCheckedAt: dateOrNull(form.get("rightToWorkCheckedAt")),
    rightToWorkExpires: dateOrNull(form.get("rightToWorkExpires")),
    optOut48SignedAt: dateOrNull(form.get("optOut48SignedAt")),
    qualificationExpiry,
    phone: phone || null,
    payrollId: String(form.get("payrollId") ?? "").trim().slice(0, 30) || null,
    notify: { email: form.get("notifyEmail") === "on", sms: form.get("notifySms") === "on", push: form.get("notifyPush") === "on" },
    ...(can(access, "pay.view") ? { hourlyRate: rate } : {}),
  };
  await (await db()).update("employees", employeeId, patch);
  await audit(storeId, access.actor, "employee.compliance_saved", { employeeId, payChanged: can(access, "pay.view") && rate !== (e.hourlyRate ?? null) });
  revalidatePath(`/s/${storeId}/staff`);
  return { ok: true };
}

/** Sister sites (same group) this person can also be rostered at. */
export async function setAllowedSites(storeId: string, employeeId: string, form: FormData) {
  const { actor, store } = await requireStore(storeId, "staff.manage");
  const e = await ownEmployee(storeId, employeeId);
  if (!e || !store.orgId) return;
  const sisters = new Set((await orgStores(store.orgId)).filter((s) => s.id !== storeId).map((s) => s.id));
  const ids = form.getAll("sites").map(String).filter((id) => sisters.has(id));
  await (await db()).update("employees", employeeId, { allowedStoreIds: ids });
  await audit(storeId, actor, "employee.sites_set", { employeeId, sites: ids });
  revalidatePath(`/s/${storeId}/staff/${employeeId}`);
}

export async function removeEmployee(storeId: string, employeeId: string) {
  const { actor } = await requireStore(storeId, "staff.manage");
  const d = await db();
  if (!(await ownEmployee(storeId, employeeId))) return;
  // Rules naming this person would no longer make sense: remove them too.
  for (const r of await d.list("rules", { storeId })) {
    const c = r.constraint as { employee?: string | null; employees?: string[] };
    if (c.employee === employeeId || c.employees?.includes(employeeId)) {
      await d.remove("rules", { id: r.id });
      await audit(storeId, actor, "rule.deleted", { ruleId: r.id, reason: "employee removed" });
    }
  }
  await d.remove("availability", { employeeId });
  await d.remove("employees", { id: employeeId });
  await audit(storeId, actor, "employee.deleted", { employeeId });
  revalidatePath(`/s/${storeId}/staff`);
  redirect(`/s/${storeId}/staff`);
}

/** A manager's change to someone's usual pattern applies straight away. */
export async function saveUsualAvailability(storeId: string, employeeId: string, days: WeekWindows) {
  const { actor } = await requireStore(storeId, "staff.manage");
  if (!(await ownEmployee(storeId, employeeId))) return { ok: false, error: "Not found" };
  const parsed = WeekSchema.safeParse(days);
  if (!parsed.success) return { ok: false, error: "Times must be HH:MM" };
  await setUsualAvailability(storeId, employeeId, parsed.data, actor, true);
  await audit(storeId, actor, "availability.saved", { employeeId, kind: "default" });
  revalidatePath(`/s/${storeId}`, "layout");
  return { ok: true };
}

export async function addTemporary(storeId: string, employeeId: string, input: unknown, days: WeekWindows) {
  const { actor } = await requireStore(storeId, "staff.manage");
  if (!(await ownEmployee(storeId, employeeId))) return { ok: false, error: "Not found" };
  const i = TempInput.safeParse(input);
  const w = WeekSchema.safeParse(days);
  if (!i.success) return { ok: false, error: z.prettifyError(i.error) };
  if (!w.success) return { ok: false, error: "Times must be HH:MM" };
  const row = await addTemporaryAvailability(storeId, employeeId, i.data, w.data, actor, true);
  await audit(storeId, actor, "availability.temporary_added", { employeeId, startWeek: row.startWeek, endWeek: row.endWeek });
  revalidatePath(`/s/${storeId}`, "layout");
  return { ok: true, info: "Added. It ends on its own." };
}

export async function removeAvailability(storeId: string, id: string) {
  const { actor } = await requireStore(storeId, "staff.manage");
  const d = await db();
  const row = await d.get("availability", id);
  if (!row || row.storeId !== storeId || row.kind !== "temporary") return;
  await d.remove("availability", { id });
  await audit(storeId, actor, "availability.temporary_removed", { employeeId: row.employeeId });
  revalidatePath(`/s/${storeId}`, "layout");
}
