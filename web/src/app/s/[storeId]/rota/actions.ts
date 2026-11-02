"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { requireStore, storeActive } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { db, isDemo, newId, now } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { checkRota, SolverDown, solveWeek } from "@/lib/solver";
import { shiftLabel } from "@/lib/swaps";
import { applyLock, liveAssignments } from "@/lib/live";
import { isMonday } from "@/lib/time";
import type { Assignment, Issue, Rota, RotaException } from "@/lib/types";

const Assignments = z.array(z.object({ shiftId: z.string().max(60), employeeId: z.string().max(60) })).max(2000);
const Exceptions = z.array(z.object({ shiftId: z.string().max(60), employeeId: z.string().max(60) })).max(500);
type ExceptionKey = z.infer<typeof Exceptions>[number];

async function getRota(storeId: string, weekStart: string) {
  const [rota] = await (await db()).list("rotas", { storeId, weekStart });
  return rota ?? null;
}

/**
 * The browser only says *which* assignments are out-of-availability asks. Their status
 * (pending / agreed / declined) always comes from the server, so it can't be faked.
 */
function mergeExceptions(existing: RotaException[], keys: ExceptionKey[], assignments: Assignment[], actor: string): RotaException[] {
  const assigned = new Set(assignments.map((a) => `${a.shiftId}|${a.employeeId}`));
  const out: RotaException[] = [];
  for (const k of keys) {
    const id = `${k.shiftId}|${k.employeeId}`;
    if (!assigned.has(id) || out.some((x) => x.shiftId === k.shiftId && x.employeeId === k.employeeId)) continue;
    const prev = existing.find((x) => x.shiftId === k.shiftId && x.employeeId === k.employeeId);
    out.push(prev ?? { ...k, status: "pending", requestedBy: actor, requestedAt: now(), respondedAt: null });
  }
  return out;
}

async function upsertDraft(storeId: string, weekStart: string, assignments: Assignment[], exceptions: RotaException[], generated: boolean) {
  const d = await db();
  const existing = await getRota(storeId, weekStart);
  const ts = now();
  if (existing) {
    return d.update("rotas", existing.id, { assignments, exceptions, status: "draft", updatedAt: ts, ...(generated ? { generatedAt: ts } : {}) });
  }
  return d.insert("rotas", { id: newId(), storeId, weekStart, assignments, exceptions, status: "draft", version: 1, approvedBy: null, approvedAt: null, generatedAt: generated ? ts : null, updatedAt: ts });
}

export type GenerateResult =
  | { ok: true; assignments: Assignment[]; issues: Issue[]; missingAvailability: string[]; seconds?: number }
  | { ok: false; error: string; reasons?: string[] };

export async function generateRota(storeId: string, weekStart: string): Promise<GenerateResult> {
  const { store, actor } = await requireStore(storeId, "rota.edit");
  if (!isMonday(weekStart)) return { ok: false, error: "Pick a week starting on a Monday." };
  if (!storeActive(store) && !isDemo()) return { ok: false, error: "Your trial has ended. Subscribe in Settings to generate rotas." };
  const existing = await getRota(storeId, weekStart);
  if (existing?.status === "approved") return { ok: false, error: "This week is approved and locked. Unlock it first to regenerate." };
  try {
    const r = await solveWeek(store, weekStart);
    if (r.status !== "ok") {
      await audit(storeId, actor, "rota.generate_failed", { weekStart, reasons: r.reasons });
      return { ok: false, error: "No rota fits all the rules this week.", reasons: r.reasons };
    }
    // The solver only ever uses people inside their availability, so no out-of-hours asks.
    await upsertDraft(storeId, weekStart, r.assignments, [], true);
    await audit(storeId, actor, "rota.generated", { weekStart, assignments: r.assignments.length, seconds: r.stats?.seconds });
    revalidatePath(`/s/${storeId}/rota`);
    return { ok: true, assignments: r.assignments, issues: r.issues, missingAvailability: r.missingAvailability, seconds: r.stats?.seconds };
  } catch (e) {
    return { ok: false, error: e instanceof SolverDown ? e.message : `Couldn't generate: ${(e as Error).message}` };
  }
}

export async function checkDraft(storeId: string, weekStart: string, assignments: Assignment[], exceptionKeys: ExceptionKey[]): Promise<{ issues: Issue[]; error?: string }> {
  const { store, actor } = await requireStore(storeId, "rota.edit");
  const a = Assignments.safeParse(assignments);
  const x = Exceptions.safeParse(exceptionKeys);
  if (!a.success || !x.success || !isMonday(weekStart)) return { issues: [], error: "Bad request" };
  const existing = (await getRota(storeId, weekStart))?.exceptions ?? [];
  try {
    return { issues: (await checkRota(store, weekStart, a.data, mergeExceptions(existing, x.data, a.data, actor))).issues };
  } catch (e) {
    return { issues: [], error: e instanceof SolverDown ? e.message : (e as Error).message };
  }
}

export async function saveDraft(storeId: string, weekStart: string, assignments: Assignment[], exceptionKeys: ExceptionKey[]) {
  const { actor, store } = await requireStore(storeId, "rota.edit");
  const a = Assignments.safeParse(assignments);
  const x = Exceptions.safeParse(exceptionKeys);
  if (!a.success || !x.success || !isMonday(weekStart)) return { ok: false, error: "Bad request" };
  if (x.data.length && !hasFeature(store.features, "outOfHours")) return { ok: false, error: "Asking staff to work outside their availability is switched off." };
  const existing = await getRota(storeId, weekStart);
  if (existing?.status === "approved") return { ok: false, error: "This week is approved and locked." };
  await upsertDraft(storeId, weekStart, a.data, mergeExceptions(existing?.exceptions ?? [], x.data, a.data, actor), false);
  await audit(storeId, actor, "rota.draft_saved", { weekStart, assignments: a.data.length });
  revalidatePath(`/s/${storeId}/rota`);
  return { ok: true };
}

export async function approveRota(storeId: string, weekStart: string, assignments: Assignment[], exceptionKeys: ExceptionKey[], overrideErrors: boolean) {
  const { store, actor } = await requireStore(storeId, "rota.publish");
  const a = Assignments.safeParse(assignments);
  const x = Exceptions.safeParse(exceptionKeys);
  if (!a.success || !x.success || !isMonday(weekStart)) return { ok: false, error: "Bad request" };
  if (x.data.length && !hasFeature(store.features, "outOfHours")) return { ok: false, error: "Asking staff to work outside their availability is switched off." };
  const existing = await getRota(storeId, weekStart);
  const { live, suggestions, keptPast } = applyLock(store, weekStart, a.data, existing ? liveAssignments(existing) : null);
  const exceptions = mergeExceptions(existing?.exceptions ?? [], x.data, live, actor);
  let issues: Issue[];
  try {
    // What goes live is what must be legal.
    issues = (await checkRota(store, weekStart, live, exceptions)).issues;
  } catch (e) {
    return { ok: false, error: e instanceof SolverDown ? e.message : (e as Error).message };
  }
  const errors = issues.filter((i) => i.severity === "error");
  const blocking = errors.filter((i) => i.blocking || i.legal);
  if (blocking.length)
    return { ok: false, error: `${blocking.length} problem(s) must be fixed before publishing: legal limits (rest, breaks, under-18 rules) and contracted hours can't be overridden.`, issues };
  if (errors.length && !overrideErrors) return { ok: false, error: `${errors.length} rule problem(s) remain. Fix them or tick “approve anyway”.`, issues };

  const draft = await upsertDraft(storeId, weekStart, live, exceptions, false);
  const d = await db();
  const approved: Rota = await d.update("rotas", draft.id, { status: "approved", published: live, approvedBy: actor, approvedAt: now(), updatedAt: now() });
  await d.insert("rota_history", { id: newId(), storeId, rotaId: approved.id, version: approved.version, status: "approved", assignments: live, by: actor, reason: errors.length ? `Approved with ${errors.length} rule problem(s) overridden` : "Approved", at: now() });
  await audit(storeId, actor, "rota.approved", { weekStart, version: approved.version, overriddenErrors: errors.map((e) => e.message), outOfAvailabilityAsks: exceptions.filter((e) => e.status === "pending").length, changesSuggested: suggestions.length, pastChangesIgnored: keptPast });

  // Changes within 24 hours: suggest them to the person affected instead of applying them.
  for (const old of await d.list("change_requests", { storeId, rotaId: approved.id, status: "pending" })) {
    await d.update("change_requests", old.id, { status: "expired", respondedAt: now() });
  }
  for (const c of suggestions) {
    await d.insert("change_requests", { id: newId(), storeId, rotaId: approved.id, weekStart, shiftId: c.shiftId, employeeId: c.employeeId, kind: c.kind, status: "pending", proposedBy: actor, createdAt: now(), respondedAt: null });
    const emp = await d.get("employees", c.employeeId);
    const label = shiftLabel(store, approved, c.shiftId);
    await sendEmail(storeId, emp?.email ?? null, c.kind === "add" ? `Can you work ${label}?` : `Change to your shift: ${label}`, `Your manager has suggested ${c.kind === "add" ? `adding you to ${label}` : `taking you off ${label}`}. It starts within 24 hours, so nothing changes unless you accept it in Rota Agent.`);
  }

  // Ask each person put on a shift outside their availability to agree.
  for (const ex of exceptions.filter((e) => e.status === "pending")) {
    const emp = await d.get("employees", ex.employeeId);
    await sendEmail(storeId, emp?.email ?? null, `Can you work ${shiftLabel(store, approved, ex.shiftId)}?`, `Your manager has asked you to work ${shiftLabel(store, approved, ex.shiftId)}, which is outside your usual availability.\nOpen Rota Agent to agree or decline.`);
  }
  revalidatePath(`/s/${storeId}`, "layout");
  return { ok: true, suggested: suggestions.length, keptPast };
}

export async function unlockRota(storeId: string, weekStart: string) {
  const { actor } = await requireStore(storeId, "rota.publish");
  const rota = await getRota(storeId, weekStart);
  if (!rota || rota.status !== "approved") return;
  // Open swaps on the old version would no longer line up.
  const d = await db();
  for (const s of await d.list("swap_requests", { storeId, rotaId: rota.id })) {
    if (s.status === "open" || s.status === "pending_approval") await d.update("swap_requests", s.id, { status: "cancelled", decidedBy: actor, decidedAt: now() });
  }
  // Staff keep seeing the published version while it's being edited.
  await d.update("rotas", rota.id, { status: "draft", published: liveAssignments(rota), version: rota.version + 1, approvedBy: null, approvedAt: null, updatedAt: now() });
  await audit(storeId, actor, "rota.unlocked", { weekStart, newVersion: rota.version + 1 });
  revalidatePath(`/s/${storeId}`, "layout");
}
