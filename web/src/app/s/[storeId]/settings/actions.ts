"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireManager, requireStore } from "@/lib/auth";
import { checkoutUrl, portalUrl, stripeConfigured } from "@/lib/billing";
import { db, isDemo, now } from "@/lib/db";
import { deleteStore } from "@/lib/store-data";
import type { Plan } from "@/lib/types";

export async function subscribe(storeId: string, plan: Exclude<Plan, "trial">) {
  const { store, actor } = await requireStore(storeId, "account.billing");
  if (stripeConfigured() && !isDemo()) redirect(await checkoutUrl(store, plan, actor));
  // Demo / no Stripe keys: simulate a successful subscription.
  await (await db()).update("stores", storeId, { plan, billingStatus: "active", cancelledAt: null });
  await audit(storeId, actor, "billing.simulated_subscribe", { plan });
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function manageBilling(storeId: string) {
  const { store, actor } = await requireStore(storeId, "account.billing");
  if (stripeConfigured() && store.stripeCustomerId && !isDemo()) redirect(await portalUrl(store));
  await (await db()).update("stores", storeId, { billingStatus: "cancelled", cancelledAt: now() });
  await audit(storeId, actor, "billing.simulated_cancel", {});
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function deleteAllData(storeId: string, form: FormData) {
  const { store, actor, isPrimary } = await requireStore(storeId, "account.billing");
  if (!isPrimary) return; // only the Account Primary can delete the whole account
  if (String(form.get("confirm") ?? "").trim() !== store.name) redirect(`/s/${storeId}/settings?delete=mismatch#danger`);
  console.info(`store ${storeId} deleted by ${actor}`);
  await deleteStore(storeId);
  redirect("/stores");
}

export async function resetDemoData() {
  if (!isDemo()) return;
  await requireManager();
  const { resetDemoData: reset } = await import("@/lib/db");
  await reset();
  revalidatePath("/", "layout");
}

/** Labour budget and the store phone number staff can ring from the app. */
export async function saveOperations(storeId: string, form: FormData) {
  const { actor } = await requireStore(storeId, "account.admin");
  const num = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  };
  const budget = num("weeklyLabourBudget");
  const phone = String(form.get("phone") ?? "").replace(/[^\d+ ]/g, "").trim().slice(0, 20);
  await (await db()).update("stores", storeId, { weeklyLabourBudget: budget != null && budget >= 0 ? budget : null, phone: phone.replace(/\D/g, "").length >= 7 ? phone : null });
  await audit(storeId, actor, "store.operations_saved", { budget: budget != null, phone: !!phone });
  revalidatePath(`/s/${storeId}`, "layout");
}
