import { redirect } from "next/navigation";
import { requireStore } from "@/lib/auth";
import { homeSection } from "@/lib/nav";

export default async function StoreHome({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId);
  redirect(`/s/${storeId}/${homeSection(access.perms) ?? "rota"}`);
}
