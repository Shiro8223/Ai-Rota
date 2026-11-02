"use server";

import { limit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { translateRule } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireStore, storeActive } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { validateConstraint, type RuleContext } from "@/lib/constraints";
import { db, isDemo, newId, now } from "@/lib/db";

export type RuleFormState = { error?: string; ok?: boolean } | undefined;

async function context(storeId: string): Promise<RuleContext & { store: Awaited<ReturnType<typeof requireStore>>["store"]; actor: string }> {
  const { store, actor } = await requireStore(storeId, "rules.manage");
  const employees = await (await db()).list("employees", { storeId, active: true });
  const roleNames = (await (await db()).list("roles", { storeId })).map((r) => r.name);
  return { store, actor, templates: store.shiftTemplates, employees, roleNames };
}

/** Translate plain English with the AI and save it as a *pending* rule for the manager to confirm. */
export async function addRule(storeId: string, ruleId: string | null, _: RuleFormState, form: FormData): Promise<RuleFormState> {
  const ctx = await context(storeId);
  if (!hasFeature(ctx.store.features, "aiRules")) return { error: "Plain-English rules are switched off." };
  if (!storeActive(ctx.store) && !isDemo()) return { error: "Your trial has ended. Subscribe in Settings to add rules." };
  const text = String(form.get("text") ?? "").trim();
  if (!limit("ruleTranslate", storeId).ok) return { error: "Too many rules in a short time. Wait a few minutes." };
  const r = await translateRule(ctx.store, ctx, text);
  if (!r.ok) return { error: r.error };
  const d = await db();
  if (ruleId) {
    const existing = await d.get("rules", ruleId);
    if (!existing || existing.storeId !== storeId) return { error: "Rule not found" };
    await d.update("rules", ruleId, { originalText: text, constraint: r.constraint, summary: r.summary, status: "pending", confirmedBy: null, confirmedAt: null });
    await audit(storeId, ctx.actor, "rule.edited", { ruleId, constraintType: r.constraint.type });
  } else {
    const id = newId();
    await d.insert("rules", { id, storeId, originalText: text, constraint: r.constraint, summary: r.summary, status: "pending", createdBy: ctx.actor, createdAt: now(), confirmedBy: null, confirmedAt: null });
    // never_together rules are logged with who/when but never a reason.
    await audit(storeId, ctx.actor, "rule.created", { ruleId: id, constraintType: r.constraint.type });
  }
  revalidatePath(`/s/${storeId}/rules`);
  return { ok: true };
}

export async function confirmRule(storeId: string, ruleId: string) {
  const ctx = await context(storeId);
  const d = await db();
  const rule = await d.get("rules", ruleId);
  if (!rule || rule.storeId !== storeId) return;
  // Re-validate against today's staff and shifts before it can reach the solver.
  const v = validateConstraint(rule.constraint, ctx);
  if (!v.ok) {
    await d.update("rules", ruleId, { summary: `Can't confirm: ${v.error}` });
  } else {
    await d.update("rules", ruleId, { status: "confirmed", confirmedBy: ctx.actor, confirmedAt: now() });
    await audit(storeId, ctx.actor, "rule.confirmed", { ruleId, constraintType: rule.constraint.type });
  }
  revalidatePath(`/s/${storeId}/rules`);
}

export async function deleteRule(storeId: string, ruleId: string) {
  const { actor } = await requireStore(storeId, "rules.manage");
  const d = await db();
  const rule = await d.get("rules", ruleId);
  if (!rule || rule.storeId !== storeId) return;
  await d.remove("rules", { id: ruleId });
  await audit(storeId, actor, "rule.deleted", { ruleId, constraintType: rule.constraint.type });
  revalidatePath(`/s/${storeId}/rules`);
}
