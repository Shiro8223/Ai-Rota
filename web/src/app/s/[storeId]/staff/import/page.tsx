import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireStore } from "@/lib/auth";
import { Importer } from "./importer";

export default async function ImportPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  await requireStore(storeId, "staff.manage");
  return (
    <>
      <PageHeader title="Import staff" sub={<Link href={`/s/${storeId}/staff`} className="text-brand-700 hover:underline">← All staff</Link>} />
      <p className="mb-4 max-w-2xl text-sm text-stone-600">
        Only scheduling details are imported: name, role, start date, hours, an under-18 flag, an optional email and availability. Leave out addresses, NI numbers and pay rates.
      </p>
      <Importer storeId={storeId} />
    </>
  );
}
