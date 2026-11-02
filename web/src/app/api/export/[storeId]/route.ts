import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { exportStore } from "@/lib/store-data";

export async function GET(_: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const { store, actor } = await requireStore(storeId, "account.billing");
  const data = await exportStore(storeId);
  await audit(storeId, actor, "data.exported", {});
  const name = store.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}-export-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
