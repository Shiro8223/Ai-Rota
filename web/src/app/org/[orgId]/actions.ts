"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import { groupCheckoutUrl, stripeConfigured } from "@/lib/billing";
import { db, isDemo, newId } from "@/lib/db";
import { PolicySchema } from "@/lib/holiday-server";
import { addSite, PUSH_ITEMS, pushSetup, requireOrg, type PushItem } from "@/lib/org-admin";
import { ALL_PERMISSIONS, FEATURE_KEYS, type FeatureKey, type Permission } from "@/lib/roles";
import { getSession } from "@/lib/session";

type Result = { ok: boolean; error?: string; info?: string };
const refresh = (orgId: string) => {
  revalidatePath(`/org/${orgId}`, "layout");
  revalidatePath("/s", "layout");
};

export async function pushBrandSetup(orgId: string, input: { sourceId: string; targetIds: string[]; items: string[] }): Promise<Result> {
  const { actor, sites } = await requireOrg(orgId, true);
  const ids = new Set(sites.map((s) => s.id));
  if (!ids.has(input.sourceId)) return { ok: false, error: "Pick a site to copy from." };
  const targets = input.targetIds.filter((id) => ids.has(id) && id !== input.sourceId);
  const items = input.items.filter((i): i is PushItem => i in PUSH_ITEMS);
  if (!targets.length || !items.length) return { ok: false, error: "Pick at least one site to update and one thing to copy." };
  const report = await pushSetup(orgId, input.sourceId, targets, items, actor);
  refresh(orgId);
  return { ok: true, info: report.join(" · ") };
}

/** Brand default for a feature; `locked` = sites can't change it. */
export async function setBrandFeature(orgId: string, key: string, value: boolean, locked: boolean): Promise<Result> {
  const { org } = await requireOrg(orgId, true);
  if (!FEATURE_KEYS.includes(key as FeatureKey)) return { ok: false, error: "Unknown feature" };
  const lockedFeatures = new Set(org.lockedFeatures ?? []);
  if (locked) lockedFeatures.add(key as FeatureKey);
  else lockedFeatures.delete(key as FeatureKey);
  await (await db()).update("organisations", orgId, { features: { ...org.features, [key]: value }, lockedFeatures: [...lockedFeatures] });
  refresh(orgId);
  return { ok: true };
}

export async function setBrandHoliday(orgId: string, policy: unknown, locked: boolean): Promise<Result> {
  await requireOrg(orgId, true);
  const p = PolicySchema.safeParse(policy);
  if (!p.success) return { ok: false, error: z.prettifyError(p.error) };
  await (await db()).update("organisations", orgId, { holidayPolicy: p.data, lockHolidayPolicy: locked });
  refresh(orgId);
  return { ok: true, info: locked ? "Saved and locked for every site." : "Saved as the default for sites without their own." };
}

/** Group subscription (simulated without Stripe keys / in demo mode). */
export async function subscribeGroup(orgId: string, plan: "starter" | "pro") {
  const { org, sites, isOwner, actor } = await requireOrg(orgId, true);
  if (!isOwner) return;
  if (stripeConfigured() && !isDemo()) redirect(await groupCheckoutUrl(org, plan, sites.length, actor));
  await (await db()).update("organisations", orgId, { plan, billingStatus: "active" });
  refresh(orgId);
}

export async function addSiteAction(orgId: string, form: FormData) {
  const { org, actor, isOwner } = await requireOrg(orgId, true);
  if (!isOwner) return;
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const copyFrom = String(form.get("copyFrom") ?? "") || null;
  if (!name) return;
  const s = await getSession();
  const store = await addSite(org, name, copyFrom, actor, s?.kind === "manager" ? s.userId : org.ownerId);
  refresh(orgId);
  redirect(`/s/${store.id}/setup`);
}

const AreaManager = z.object({
  email: z.email(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length),
  storeIds: z.array(z.string()).nullable(),
});

/** Invite an area manager: chosen permissions at chosen sites (or every site). */
export async function inviteAreaManager(orgId: string, input: unknown): Promise<Result> {
  const { sites, isOwner } = await requireOrg(orgId, true);
  if (!isOwner) return { ok: false, error: "Only the group owner can invite area managers." };
  const v = AreaManager.safeParse(input);
  if (!v.success) return { ok: false, error: z.prettifyError(v.error) };
  const d = await db();
  const email = v.data.email.toLowerCase();
  if ((await d.list("org_members", { orgId })).some((m) => m.email.toLowerCase() === email)) return { ok: false, error: "That email already has group access." };
  const storeIds = v.data.storeIds === null ? null : v.data.storeIds.filter((id) => sites.some((s) => s.id === id));
  await d.insert("org_members", { id: newId(), orgId, userId: "", email, role: "manager", permissions: v.data.permissions, storeIds });
  refresh(orgId);
  return { ok: true, info: `Invited ${email}. They sign in with that email.` };
}

export async function removeAreaManager(orgId: string, memberId: string) {
  const { isOwner } = await requireOrg(orgId, true);
  const d = await db();
  const m = await d.get("org_members", memberId);
  if (!isOwner || !m || m.orgId !== orgId || m.role === "owner") return;
  await d.remove("org_members", { id: memberId });
  refresh(orgId);
}
