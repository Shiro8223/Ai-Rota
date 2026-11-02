"use server";

import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireKiosk, requireStore } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { isDemo } from "@/lib/db";
import { DEMO_MANAGER } from "@/lib/seed";
import { clearSession, setSession } from "@/lib/session";
import { kioskAct, kioskBoard, kioskLookup, type KioskAction } from "@/lib/timesheets";

const ACTIONS: KioskAction[] = ["in", "out", "breakStart", "breakEnd"];
const clean = (pin: unknown) => (typeof pin === "string" ? pin.replace(/\D/g, "").slice(0, 6) : "");

/** Manager turns this device into the site's clock-in screen (and is signed out on it). */
export async function startKiosk(storeId: string) {
  const { store, actor } = await requireStore(storeId, "timesheets.approve");
  if (!hasFeature(store.features, "clockIn")) return;
  await audit(storeId, actor, "kiosk.started", {});
  await setSession({ kind: "kiosk", storeId, startedBy: actor });
  redirect(`/kiosk/${storeId}`);
}

export async function exitKiosk(storeId: string) {
  await requireKiosk(storeId);
  await clearSession();
  redirect("/login");
}

/** Demo/dev only: hop straight back to the manager view (a real kiosk needs a manager to sign in again). */
export async function backToManager(storeId: string) {
  await requireKiosk(storeId);
  if (!isDemo()) redirect("/login");
  await setSession({ kind: "manager", userId: DEMO_MANAGER.id, email: DEMO_MANAGER.email });
  redirect(`/s/${storeId}/timesheets`);
}

export async function refreshBoard(storeId: string) {
  const { store } = await requireKiosk(storeId);
  return kioskBoard(store);
}

export async function lookup(storeId: string, employeeId: string, pin: string) {
  const { store } = await requireKiosk(storeId);
  return kioskLookup(store, String(employeeId).slice(0, 60), clean(pin));
}

export async function act(storeId: string, employeeId: string, pin: string, action: KioskAction) {
  const { store } = await requireKiosk(storeId);
  if (!ACTIONS.includes(action)) return { ok: false as const, error: "notIn" as const };
  return kioskAct(store, String(employeeId).slice(0, 60), clean(pin), action);
}
