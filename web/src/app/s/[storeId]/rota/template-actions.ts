"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { db, newId, now } from "@/lib/db";
import { liveAssignments } from "@/lib/live";
import { isMonday } from "@/lib/time";
import type { Assignment } from "@/lib/types";

const Assignments = z.array(z.object({ shiftId: z.string().max(60), employeeId: z.string().max(60) })).max(2000);

/** Assignments from another week (what staff saw) or a saved template, for the editor to reuse. */
export async function loadAssignments(storeId: string, source: { week: string } | { templateId: string }): Promise<{ ok: boolean; assignments?: Assignment[]; error?: string }> {
  await requireStore(storeId, "rota.edit");
  const d = await db();
  if ("week" in source) {
    if (!isMonday(source.week)) return { ok: false, error: "Bad week" };
    const [rota] = await d.list("rotas", { storeId, weekStart: source.week });
    if (!rota) return { ok: false, error: "There's no rota for that week to copy." };
    return { ok: true, assignments: liveAssignments(rota) ?? rota.assignments };
  }
  const t = await d.get("rota_templates", source.templateId);
  if (!t || t.storeId !== storeId) return { ok: false, error: "Template not found." };
  return { ok: true, assignments: t.assignments };
}

export async function saveTemplate(storeId: string, name: string, assignments: Assignment[]) {
  const { actor } = await requireStore(storeId, "rota.edit");
  const a = Assignments.safeParse(assignments);
  const n = String(name ?? "").trim().slice(0, 60);
  if (!a.success || !n) return { ok: false, error: "Give the template a name." };
  const d = await db();
  if ((await d.list("rota_templates", { storeId })).length >= 20) return { ok: false, error: "You can keep up to 20 templates. Delete one first." };
  await d.insert("rota_templates", { id: newId(), storeId, name: n, assignments: a.data, createdBy: actor, createdAt: now() });
  await audit(storeId, actor, "rota.template_saved", { name: n, assignments: a.data.length });
  revalidatePath(`/s/${storeId}/rota`);
  return { ok: true };
}

export async function deleteTemplate(storeId: string, id: string) {
  const { actor } = await requireStore(storeId, "rota.edit");
  const d = await db();
  const t = await d.get("rota_templates", id);
  if (!t || t.storeId !== storeId) return { ok: false };
  await d.remove("rota_templates", { id });
  await audit(storeId, actor, "rota.template_deleted", { name: t.name });
  revalidatePath(`/s/${storeId}/rota`);
  return { ok: true };
}
