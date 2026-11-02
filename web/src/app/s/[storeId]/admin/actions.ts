"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { COLOR_KEYS } from "@/lib/colors";
import { describeConstraint } from "@/lib/constraints";
import { db, newId } from "@/lib/db";
import { ALL_PERMISSIONS, FEATURE_KEYS, FEATURE_PRESETS, ROLE_CATEGORIES, type FeatureKey, type RoleCategory } from "@/lib/roles";
import { PolicySchema } from "@/lib/holiday-server";
import { orgOf } from "@/lib/org";
import { applyRolePreset, ensureSystemRoles, resyncEmployees, roleFromSeed, storeRoles } from "@/lib/team";

type Result = { ok: boolean; error?: string; info?: string };
const admin = (storeId: string) => requireStore(storeId, "account.admin");
const refresh = (storeId: string) => revalidatePath(`/s/${storeId}`, "layout");

// ------------------------------------------------------------------ roles

const RoleInput = z.object({
  name: z.string().trim().min(1, "Give the role a name").max(40),
  category: z.enum(Object.keys(ROLE_CATEGORIES) as [RoleCategory, ...RoleCategory[]]),
  color: z.enum(COLOR_KEYS as [string, ...string[]]),
  description: z.string().trim().max(160).default(""),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).max(ALL_PERMISSIONS.length),
  hourlyRate: z.number().min(0).max(500).nullable().default(null),
});

export async function saveRole(storeId: string, roleId: string | null, input: unknown): Promise<Result & { id?: string }> {
  const { actor } = await admin(storeId);
  const parsed = RoleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const v = parsed.data;
  const d = await db();
  const roles = await storeRoles(storeId);
  if (roles.some((r) => r.id !== roleId && r.name.toLowerCase() === v.name.toLowerCase())) return { ok: false, error: `There's already a role called "${v.name}".` };

  if (!roleId) {
    const role = { ...roleFromSeed(storeId, { ...v, color: v.color as never, permissions: v.permissions as never }), hourlyRate: v.hourlyRate };
    await d.insert("roles", role);
    await audit(storeId, actor, "role.created", { roleId: role.id, name: role.name, permissions: role.permissions });
    refresh(storeId);
    return { ok: true, id: role.id, info: "Role created." };
  }

  const old = roles.find((r) => r.id === roleId);
  if (!old) return { ok: false, error: "Role not found." };
  // System roles keep their meaning (Under 18 drives the law checks), so their type is fixed.
  const category = old.system ? old.category : v.category;
  await d.update("roles", roleId, { name: v.name, category, color: v.color, description: v.description, permissions: v.permissions as never, hourlyRate: v.hourlyRate });

  // Rules target roles by name: follow a rename so they keep working.
  if (old.name !== v.name) {
    const employees = await d.list("employees", { storeId, active: true });
    const ctx = { templates: (await d.get("stores", storeId))!.shiftTemplates, employees, roleNames: roles.map((r) => (r.id === roleId ? v.name : r.name)) };
    for (const rule of await d.list("rules", { storeId })) {
      const c = rule.constraint as { filter?: { field: string; value: unknown } | null };
      if (c.filter?.field === "role" && String(c.filter.value).toLowerCase() === old.name.toLowerCase()) {
        const constraint = { ...rule.constraint, filter: { ...c.filter, value: v.name } } as typeof rule.constraint;
        await d.update("rules", rule.id, { constraint, summary: describeConstraint(constraint, ctx) });
      }
    }
  }
  await resyncEmployees(storeId);
  await audit(storeId, actor, "role.updated", { roleId, name: v.name, permissions: v.permissions, renamedFrom: old.name !== v.name ? old.name : undefined });
  refresh(storeId);
  return { ok: true, id: roleId, info: "Saved." };
}

export async function deleteRole(storeId: string, roleId: string): Promise<Result> {
  const { actor } = await admin(storeId);
  const d = await db();
  const role = await d.get("roles", roleId);
  if (!role || role.storeId !== storeId) return { ok: false, error: "Role not found." };
  if (role.system) return { ok: false, error: `${role.name} is built in (the law checks depend on it). You can rename it but not delete it.` };
  const usedBy = (await d.list("rules", { storeId })).filter((r) => {
    const f = (r.constraint as { filter?: { field: string; value: unknown } | null }).filter;
    return f?.field === "role" && String(f.value).toLowerCase() === role.name.toLowerCase();
  });
  const store = await d.get("stores", storeId);
  const shiftsUsing = (store?.shiftTemplates ?? []).filter((t) => (t.requirements ?? []).some((r) => r.roleId === roleId));
  if (shiftsUsing.length) return { ok: false, error: `Shift types require this role: ${shiftsUsing.map((t) => t.name).join(", ")}. Remove it from their staffing first.` };
  if (usedBy.length) return { ok: false, error: `Rules use this role: ${usedBy.map((r) => `“${r.originalText}”`).join(", ")}. Delete or change those rules first.` };
  await d.remove("roles", { id: roleId });
  await resyncEmployees(storeId);
  await audit(storeId, actor, "role.deleted", { roleId, name: role.name });
  refresh(storeId);
  return { ok: true };
}

export async function applyPreset(storeId: string, presetKey: string): Promise<Result> {
  const { actor } = await admin(storeId);
  const added = await applyRolePreset(storeId, presetKey);
  await ensureSystemRoles(storeId);
  await audit(storeId, actor, "role.preset_applied", { preset: presetKey, added: added.map((r) => r.name) });
  refresh(storeId);
  return { ok: true, info: added.length ? `Added ${added.map((r) => r.name).join(", ")}.` : "You already have every role in that preset." };
}

// ------------------------------------------------------------------ team access (email sign-in)

export async function inviteManager(storeId: string, input: { email: string; roleIds: string[] }): Promise<Result> {
  const { actor } = await admin(storeId);
  const email = z.email().safeParse(input.email.trim().toLowerCase());
  if (!email.success) return { ok: false, error: "Enter a valid email address." };
  const d = await db();
  if ((await d.list("store_members", { storeId })).some((m) => m.email.toLowerCase() === email.data)) return { ok: false, error: "That email already has access." };
  const roles = await storeRoles(storeId);
  const roleIds = input.roleIds.filter((id) => roles.some((r) => r.id === id));
  // userId is filled in when they first sign in with this email (lib/team.ts claimInvites).
  await d.insert("store_members", { id: newId(), storeId, userId: "", email: email.data, role: "manager", roleIds });
  await audit(storeId, actor, "access.invited", { email: email.data, roleIds });
  refresh(storeId);
  return { ok: true, info: `Invited ${email.data}. They sign in with that email.` };
}

export async function setMemberRoles(storeId: string, memberId: string, roleIds: string[]): Promise<Result> {
  const { actor } = await admin(storeId);
  const d = await db();
  const m = await d.get("store_members", memberId);
  if (!m || m.storeId !== storeId || m.role === "owner") return { ok: false, error: "The Account Primary always has full access." };
  const roles = await storeRoles(storeId);
  const ids = roleIds.filter((id) => roles.some((r) => r.id === id));
  await d.update("store_members", memberId, { roleIds: ids });
  await audit(storeId, actor, "access.updated", { email: m.email, roleIds: ids });
  refresh(storeId);
  return { ok: true, info: "Saved." };
}

export async function removeMember(storeId: string, memberId: string) {
  const { actor } = await admin(storeId);
  const d = await db();
  const m = await d.get("store_members", memberId);
  if (!m || m.storeId !== storeId || m.role === "owner") return;
  await d.remove("store_members", { id: memberId });
  await audit(storeId, actor, "access.removed", { email: m.email });
  refresh(storeId);
}

// ------------------------------------------------------------------ holiday allowance

/** target: "store" (general), "role:<id>" or "person:<id>". policy null = remove the override. */
export async function saveHolidayPolicy(storeId: string, target: string, policy: unknown | null): Promise<Result> {
  const { actor } = await admin(storeId);
  const d = await db();
  let parsed = null;
  if (policy !== null) {
    const p = PolicySchema.safeParse(policy);
    if (!p.success) return { ok: false, error: z.prettifyError(p.error) };
    parsed = p.data;
  }
  if (target === "store") {
    if (!parsed) return { ok: false, error: "The general policy can't be removed." };
    const st = await d.get("stores", storeId);
    const org = st ? await orgOf(st) : null;
    if (org?.lockHolidayPolicy) return { ok: false, error: `${org.name} sets the holiday allowance for every site.` };
    await d.update("stores", storeId, { holidayPolicy: parsed });
  } else if (target.startsWith("role:")) {
    const role = await d.get("roles", target.slice(5));
    if (!role || role.storeId !== storeId) return { ok: false, error: "Role not found." };
    await d.update("roles", role.id, { holidayPolicy: parsed });
  } else if (target.startsWith("person:")) {
    const e = await d.get("employees", target.slice(7));
    if (!e || e.storeId !== storeId) return { ok: false, error: "Person not found." };
    await d.update("employees", e.id, { holidayPolicy: parsed });
  } else return { ok: false, error: "Unknown target." };
  await audit(storeId, actor, "holiday.policy_saved", { target, policy: parsed });
  refresh(storeId);
  return { ok: true, info: parsed ? "Saved." : "Override removed." };
}

// ------------------------------------------------------------------ features

export async function setFeature(storeId: string, key: string, on: boolean): Promise<Result> {
  const { store, actor } = await admin(storeId);
  if (!FEATURE_KEYS.includes(key as FeatureKey)) return { ok: false, error: "Unknown feature" };
  const org = await orgOf(store);
  if (org?.lockedFeatures?.includes(key as FeatureKey)) return { ok: false, error: `${org.name} has locked this setting for every site.` };
  await (await db()).update("stores", storeId, { features: { ...store.features, [key]: on } });
  await audit(storeId, actor, "feature.set", { feature: key, on });
  refresh(storeId);
  return { ok: true };
}

export async function applyFeaturePreset(storeId: string, presetKey: string) {
  const { actor } = await admin(storeId);
  const preset = FEATURE_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return;
  await (await db()).update("stores", storeId, { features: { ...preset.features } });
  await audit(storeId, actor, "feature.preset_applied", { preset: presetKey });
  refresh(storeId);
}

