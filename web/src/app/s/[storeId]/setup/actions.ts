"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { db } from "@/lib/db";
import { COLOR_KEYS } from "@/lib/colors";
import { storeRoles } from "@/lib/team";
import { DAYS } from "@/lib/types";

const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const SetupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  openingHours: z.record(z.enum(DAYS), z.object({ open: HM, close: HM }).nullable()),
  shiftTemplates: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,30}$/),
        name: z.string().trim().min(1).max(30),
        start: HM,
        end: HM,
        days: z.array(z.enum(DAYS)).min(1, "Pick at least one day"),
        minStaff: z.number().int().min(0).max(50),
        maxStaff: z.number().int().min(1).max(50),
        color: z.enum(COLOR_KEYS as [string, ...string[]]).optional(),
        breakMinutes: z.number().int().min(0).max(180).default(0),
        requirements: z.array(z.object({ roleId: z.string(), min: z.number().int().min(1).max(50) })).max(10).default([]),
      }),
    )
    .min(1, "Add at least one shift type"),
});

export async function saveSetup(storeId: string, input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { actor, store } = await requireStore(storeId, "shifts.manage");
  const parsed = SetupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const v = parsed.data;
  const roles = await storeRoles(storeId);
  const ids = new Set<string>();
  for (const t of v.shiftTemplates) {
    if (ids.has(t.id)) return { ok: false, error: `Two shift types share the id "${t.id}"` };
    ids.add(t.id);
    if (t.maxStaff < t.minStaff) return { ok: false, error: `${t.name}: max staff must be at least min staff` };
    const s = +t.start.slice(0, 2) * 60 + +t.start.slice(3);
    let e = +t.end.slice(0, 2) * 60 + +t.end.slice(3);
    if (e <= s) e += 1440;
    if (t.breakMinutes >= e - s) return { ok: false, error: `${t.name}: the break is longer than the shift` };
    if (e - s - t.breakMinutes > 360 && t.breakMinutes < 20) return { ok: false, error: `${t.name}: shifts over 6 working hours need at least a 20-minute unpaid break (UK Working Time Regulations)` };
    const roleIds = new Set(roles.map((r) => r.id));
    if (t.requirements.some((r) => !roleIds.has(r.roleId))) return { ok: false, error: `${t.name}: a required role no longer exists` };
    if (new Set(t.requirements.map((r) => r.roleId)).size !== t.requirements.length) return { ok: false, error: `${t.name}: each required role should be listed once` };
    if (t.requirements.reduce((n, r) => n + r.min, 0) > t.maxStaff) return { ok: false, error: `${t.name}: required roles add up to more than the maximum staff` };
  }
  // Rules may point at a shift type by id: refuse to remove one that's still used.
  const rules = await (await db()).list("rules", { storeId });
  for (const r of rules) {
    const c = r.constraint as { shift?: string };
    if (c.shift && c.shift !== "*" && !ids.has(c.shift)) return { ok: false, error: `The rule “${r.originalText}” uses the ${c.shift} shift. Delete or edit that rule first.` };
  }
  await (await db()).update("stores", storeId, { name: v.name, openingHours: { ...store.openingHours, ...v.openingHours }, shiftTemplates: v.shiftTemplates });
  await audit(storeId, actor, "store.setup_saved", { shiftTypes: v.shiftTemplates.map((t) => t.id) });
  revalidatePath(`/s/${storeId}`, "layout");
  return { ok: true };
}
