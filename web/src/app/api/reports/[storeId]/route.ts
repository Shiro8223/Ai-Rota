import { NextResponse } from "next/server";
import { can, requireStore } from "@/lib/auth";
import { siteReport } from "@/lib/reports";

const cell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId, "reports.view");
  const weeks = Math.min(26, Math.max(1, Number(new URL(req.url).searchParams.get("weeks")) || 4));
  const withPay = can(access, "pay.view");
  const r = await siteReport(access.store, weeks, withPay);
  const head = ["Name", "Shifts", "Hours worked", "Hours over contract", "Closes", "Weekend shifts", "Sick days", "Holiday left", "Unit", ...(withPay ? ["Holiday owed (GBP)"] : [])];
  const rows = r.people.map((p) => [p.name, p.shifts, +(p.workedMin / 60).toFixed(2), +(p.overtimeMin / 60).toFixed(2), p.closes, p.weekends, p.sickDays, p.holidayLeft, p.holidayUnit, ...(withPay ? [p.liability] : [])]);
  const csv = [head, ...rows].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="report-${r.start}-to-${r.end}.csv"`, "cache-control": "no-store" } });
}
