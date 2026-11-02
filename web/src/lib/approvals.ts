import "server-only";
import { db } from "./db";

/** Everything waiting on a manager: swaps, availability, holidays, declined out-of-hours asks, open-shift claims, timesheets. */
export async function pendingApprovals(storeId: string) {
  const d = await db();
  const [swaps, avail, rotas, holidays] = await Promise.all([
    d.list("swap_requests", { storeId, status: "pending_approval" }),
    d.list("availability", { storeId, status: "pending" }),
    d.list("rotas", { storeId }),
    d.list("holidays", { storeId, status: "pending" }),
  ]);
  const [openShifts, timesheets] = await Promise.all([d.list("open_shifts", { storeId, status: "claimed" }), d.list("time_entries", { storeId, status: "submitted" })]);
  const declined = rotas.flatMap((r) => (r.exceptions ?? []).filter((x) => x.status === "declined").map((x) => ({ rota: r, x })));
  return { swaps, availability: avail, declined, holidays, openShifts, timesheets, total: swaps.length + avail.length + declined.length + holidays.length + openShifts.length + timesheets.length };
}
