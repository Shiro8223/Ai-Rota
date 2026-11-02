"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { claimOpenShift, unclaimOpenShift } from "@/lib/open-shifts";
import type { PushSubscriptionJSON } from "@/lib/types";

export type WorkState = { ok?: boolean; error?: string; reasons?: string[]; info?: string } | undefined;

export async function claimAction(id: string, _: WorkState): Promise<WorkState> {
  const { employee, store } = await requireStaff();
  const r = await claimOpenShift(employee, store, id);
  revalidatePath("/me");
  return r.ok ? { ok: true } : { error: r.error, reasons: r.reasons };
}

export async function unclaimAction(id: string) {
  const { employee } = await requireStaff();
  await unclaimOpenShift(employee, id);
  revalidatePath("/me");
}

/** Save (or with null, forget) this device's push subscription. */
export async function savePush(sub: PushSubscriptionJSON | null, endpoint?: string) {
  const { employee } = await requireStaff();
  const list = (employee.pushSubscriptions ?? []).filter((s) => s.endpoint !== (sub?.endpoint ?? endpoint));
  if (sub && typeof sub.endpoint === "string" && sub.endpoint.startsWith("https://") && sub.keys?.p256dh && sub.keys?.auth) list.push({ endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } });
  await (await db()).update("employees", employee.id, { pushSubscriptions: list.slice(-5) });
  return { ok: true };
}
