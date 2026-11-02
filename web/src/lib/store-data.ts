import "server-only";
import { db, type TableName } from "./db";

const STORE_TABLES: TableName[] = ["roles", "employees", "availability", "rules", "rotas", "rota_history", "swap_requests", "holidays", "change_requests", "time_entries", "absences", "open_shifts", "rota_templates", "audit_log", "ai_calls", "emails", "store_members"];

/** Everything held for one store, for the "export my data" button. PIN hashes are left out. */
export async function exportStore(storeId: string) {
  const d = await db();
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), store: await d.get("stores", storeId) };
  for (const t of STORE_TABLES) {
    const rows = (await d.list(t, { storeId } as never)) as unknown as Record<string, unknown>[];
    out[t] = t === "employees" ? rows.map(({ pinHash: _omit, pushSubscriptions: _push, ...rest }) => rest) : rows;
  }
  return out;
}

/** Permanently delete a store and everything in it. */
export async function deleteStore(storeId: string) {
  const d = await db();
  for (const t of STORE_TABLES) await d.remove(t, { storeId } as never);
  await d.remove("stores", { id: storeId });
}

/** Delete stores whose subscription was cancelled more than 30 days ago. */
export async function purgeCancelled() {
  const d = await db();
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stores = (await d.list("stores")).filter((s) => s.cancelledAt && s.cancelledAt < cutoff);
  for (const s of stores) await deleteStore(s.id);
  return stores.map((s) => s.id);
}
