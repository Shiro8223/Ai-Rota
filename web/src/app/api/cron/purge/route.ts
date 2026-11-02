import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { purgeCancelled } from "@/lib/store-data";

/** Kept for existing schedules; /api/cron/daily does this and more. */
export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json({ deleted: await purgeCancelled() });
}
