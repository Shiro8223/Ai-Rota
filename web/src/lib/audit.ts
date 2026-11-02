import "server-only";
import { db, newId, now } from "./db";

export async function audit(storeId: string, actor: string, action: string, details: Record<string, unknown> = {}) {
  await (await db()).insert("audit_log", { id: newId(), storeId, actor, action, details, at: now() });
}
