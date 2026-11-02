import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { can, requireStore } from "@/lib/auth";
import { PAYROLL_FORMATS, payrollCsv, payrollRows, type PayrollFormat } from "@/lib/timesheets";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId, "timesheets.approve");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const format = (url.searchParams.get("format") ?? "generic") as PayrollFormat;
  if (!DATE.test(from) || !DATE.test(to) || to < from || !(format in PAYROLL_FORMATS)) return NextResponse.json({ error: "Give from/to dates (YYYY-MM-DD) and a known format." }, { status: 400 });
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 62) return NextResponse.json({ error: "Export at most two months at a time." }, { status: 400 });
  const withPay = can(access, "pay.view");
  const data = await payrollRows(access.store, from, to, withPay);
  await audit(storeId, access.actor, "payroll.exported", { from, to, format, people: data.rows.length, withPay });
  const name = access.store.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(payrollCsv(format, data, from, to, withPay), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-payroll-${format}-${from}-to-${to}.csv"`, "cache-control": "no-store" },
  });
}
