import "server-only";
import { notFound, redirect } from "next/navigation";
import { audit } from "./audit";
import { describeConstraint, validateConstraint } from "./constraints";
import { db, newId, now } from "./db";
import { orgStores } from "./org";
import { ALL_PERMISSIONS, type Permission } from "./roles";
import { getSession } from "./session";
import { ensureSystemRoles, resyncEmployees, roleFromSeed, storeRoles } from "./team";
import { addDays, isoDate } from "./time";
import type { Organisation, OrgMember, Store } from "./types";

export interface OrgAccess { org: Organisation; member: OrgMember; isOwner: boolean; sites: Store[]; perms: Set<Permission>; actor: string }

/** Group dashboard access: the group owner, or an area manager (sees only their sites). */
export async function requireOrg(orgId: string, ownerOnly = false): Promise<OrgAccess> {
  const s = await getSession();
  if (!s || s.kind !== "manager") redirect("/login");
  const d = await db();
  const org = await d.get("organisations", orgId);
  if (!org) notFound();
  const [member] = await d.list("org_members", { orgId, userId: s.userId });
  if (!member) notFound();
  const isOwner = member.role === "owner";
  if (ownerOnly && !isOwner && !member.permissions.includes("account.admin")) notFound();
  const all = await orgStores(orgId);
  const sites = member.storeIds === null ? all : all.filter((x) => member.storeIds!.includes(x.id));
  return { org, member, isOwner, sites, perms: new Set(isOwner ? ALL_PERMISSIONS : member.permissions), actor: s.email };
}

export const PUSH_ITEMS = {
  roles: "Roles & permissions",
  shifts: "Shift types & staffing",
  rules: "Rules (not ones naming a person)",
  features: "Feature switches",
  holiday: "Holiday allowance",
} as const;
export type PushItem = keyof typeof PUSH_ITEMS;

/**
 * Copy brand setup from one site to others. Roles are matched by name (built-in ones by
 * their meaning) and updated or added, never removed. Shift requirements are re-pointed at
 * the target's roles. Rules naming a specific person are skipped (they don't travel).
 */
export async function pushSetup(orgId: string, sourceId: string, targetIds: string[], items: PushItem[], actor: string) {
  const d = await db();
  const sites = await orgStores(orgId);
  const source = sites.find((s) => s.id === sourceId);
  if (!source) throw new Error("Unknown source site");
  const srcRoles = await storeRoles(source.id);
  const report: string[] = [];
  for (const target of sites.filter((s) => targetIds.includes(s.id) && s.id !== sourceId)) {
    const done: string[] = [];
    if (items.includes("roles")) {
      const existing = await storeRoles(target.id);
      for (const r of srcRoles) {
        const match = existing.find((x) => (r.system && x.system === r.system) || x.name.toLowerCase() === r.name.toLowerCase());
        const fields = { name: r.name, category: r.category, color: r.color, description: r.description, permissions: [...r.permissions], holidayPolicy: r.holidayPolicy ?? null };
        if (match) await d.update("roles", match.id, fields);
        else await d.insert("roles", { ...roleFromSeed(target.id, { ...fields, color: r.color as never, system: r.system ?? undefined }), holidayPolicy: r.holidayPolicy ?? null });
      }
      await ensureSystemRoles(target.id);
      await resyncEmployees(target.id);
      done.push("roles");
    }
    const targetRoles = await storeRoles(target.id);
    const roleIdByName = Object.fromEntries(targetRoles.map((r) => [r.name.toLowerCase(), r.id]));
    const srcRoleName = Object.fromEntries(srcRoles.map((r) => [r.id, r.name.toLowerCase()]));
    if (items.includes("shifts")) {
      const templates = source.shiftTemplates.map((t) => ({
        ...t,
        days: [...t.days],
        requirements: (t.requirements ?? []).map((q) => ({ roleId: roleIdByName[srcRoleName[q.roleId]], min: q.min })).filter((q) => q.roleId),
      }));
      await d.update("stores", target.id, { shiftTemplates: templates, openingHours: { ...source.openingHours } });
      done.push("shift types");
    }
    if (items.includes("rules")) {
      const tStore = (await d.get("stores", target.id))!;
      const employees = await d.list("employees", { storeId: target.id, active: true });
      const ctx = { templates: tStore.shiftTemplates, employees, roleNames: targetRoles.map((r) => r.name) };
      const have = new Set((await d.list("rules", { storeId: target.id })).map((r) => r.originalText.toLowerCase()));
      let added = 0;
      for (const r of await d.list("rules", { storeId: source.id, status: "confirmed" })) {
        const c = r.constraint as { employee?: string | null; employees?: string[] };
        if (r.weekStart || c.employee || c.employees || have.has(r.originalText.toLowerCase())) continue;
        const v = validateConstraint(structuredClone(r.constraint), ctx);
        if (!v.ok) continue;
        await d.insert("rules", { ...r, id: newId(), storeId: target.id, constraint: v.constraint, summary: describeConstraint(v.constraint, ctx), createdBy: `${actor} (brand)`, createdAt: now(), confirmedBy: actor, confirmedAt: now() });
        added++;
      }
      done.push(`${added} rule${added === 1 ? "" : "s"}`);
    }
    if (items.includes("features")) {
      await d.update("stores", target.id, { features: { ...source.features } });
      done.push("features");
    }
    if (items.includes("holiday") && source.holidayPolicy) {
      await d.update("stores", target.id, { holidayPolicy: { ...source.holidayPolicy } });
      done.push("holiday allowance");
    }
    await audit(target.id, actor, "brand.pushed", { from: source.name, items });
    report.push(`${target.name}: ${done.join(", ") || "nothing to copy"}`);
  }
  return report;
}

/** New site in the group, set up like an existing one (roles, shifts, rules, features, holiday). */
export async function addSite(org: Organisation, name: string, copyFromId: string | null, actor: string, userId: string) {
  const d = await db();
  let joinCode = "";
  do {
    joinCode = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  } while ((await d.list("stores", { joinCode })).length);
  const template = copyFromId ? await d.get("stores", copyFromId) : null;
  const store: Store = {
    id: newId(), orgId: org.id, ownerId: userId, name, timezone: "Europe/London",
    openingHours: template ? { ...template.openingHours } : ({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } as Store["openingHours"]),
    shiftTemplates: [], joinCode, plan: "trial", billingStatus: "trialing", trialEndsAt: addDays(isoDate(new Date()), 30),
    cancelledAt: null, stripeCustomerId: null, stripeSubscriptionId: null, features: template ? { ...template.features } : {}, createdAt: now(),
  };
  await d.insert("stores", store);
  await ensureSystemRoles(store.id);
  if (template) await pushSetup(org.id, template.id, [store.id], ["roles", "shifts", "rules", "features", "holiday"], actor);
  await audit(store.id, actor, "store.created", { name, org: org.name, copiedFrom: template?.name ?? null });
  return store;
}
