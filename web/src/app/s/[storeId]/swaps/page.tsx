import { redirect } from "next/navigation";

export default async function SwapsRedirect({ params }: { params: Promise<{ storeId: string }> }) {
  redirect(`/s/${(await params).storeId}/approvals`);
}
