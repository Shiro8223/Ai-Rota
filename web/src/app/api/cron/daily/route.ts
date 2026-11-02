import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/cron-auth";
import { runDaily } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  return NextResponse.json(await runDaily());
}
