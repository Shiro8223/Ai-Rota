"use server";

import { limit } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { assistantContext, createRule, runAssistant, type AssistantReply } from "@/lib/assistant";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { validateConstraint } from "@/lib/constraints";
import { db, now } from "@/lib/db";
import { hasFeature } from "@/lib/roles";
import { storeRoles } from "@/lib/team";
import { isMonday } from "@/lib/time";

const History = z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(30);
const WHO = ["rota.edit", "rules.manage", "account.admin"] as const;

export async function askAssistant(storeId: string, week: string, history: unknown): Promise<AssistantReply> {
  const access = await requireStore(storeId, [...WHO]);
  if (!hasFeature(access.store.features, "assistant")) return { reply: "The rota assistant is switched off in Admin → Features.", actions: [], usedAi: false };
  const rl = limit("assistant", `${storeId}:${access.actor}`);
  if (!rl.ok) return { reply: `That's a lot of questions in a short time. Try again in ${Math.ceil(rl.retryInSec / 60)} min.`, actions: [], usedAi: false };
  const h = History.safeParse(history);
  if (!h.success || !isMonday(week)) return { reply: "Sorry, I couldn't read that message.", actions: [], usedAi: false };
  return runAssistant(access, week, h.data);
}

/** "Add as this-week rule" button on an assistant suggestion. Saved as pending. */
export async function addSuggestedRule(storeId: string, week: string, text: string, scope: "permanent" | "week") {
  const access = await requireStore(storeId, "rules.manage");
  if (!isMonday(week)) return { ok: false as const, error: "Bad week" };
  if (!limit("ruleTranslate", storeId).ok) return { ok: false as const, error: "Too many rules in a short time. Wait a few minutes." };
  const r = await createRule(await assistantContext(access, week), text.slice(0, 300), scope === "week" ? "week" : "permanent");
  revalidatePath(`/s/${storeId}/rules`);
  return r;
}

export async function decideAssistantRule(storeId: string, ruleId: string, confirm: boolean) {
  const { actor, store } = await requireStore(storeId, "rules.manage");
  const d = await db();
  const rule = await d.get("rules", ruleId);
  if (!rule || rule.storeId !== storeId || rule.status !== "pending") return { ok: false };
  if (!confirm) {
    await d.remove("rules", { id: ruleId });
    await audit(storeId, actor, "rule.deleted", { ruleId, via: "assistant" });
  } else {
    const employees = await d.list("employees", { storeId, active: true });
    const v = validateConstraint(rule.constraint, { templates: store.shiftTemplates, employees, roleNames: (await storeRoles(storeId)).map((r) => r.name) });
    if (!v.ok) return { ok: false, error: v.error };
    await d.update("rules", ruleId, { status: "confirmed", confirmedBy: actor, confirmedAt: now() });
    await audit(storeId, actor, "rule.confirmed", { ruleId, via: "assistant", weekStart: rule.weekStart ?? null });
  }
  revalidatePath(`/s/${storeId}/rules`);
  return { ok: true };
}
