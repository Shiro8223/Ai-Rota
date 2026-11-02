import { PageHeader } from "@/components/ui";
import { requireStore } from "@/lib/auth";
import { storeRoles } from "@/lib/team";
import { SetupEditor } from "./editor";

export default async function SetupPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { store } = await requireStore((await params).storeId, "shifts.manage");
  const roles = (await storeRoles(store.id)).filter((r) => r.category === "job" || r.category === "access").map((r) => ({ id: r.id, name: r.name, category: r.category, color: r.color }));
  return (
    <>
      <PageHeader title="Shift types & staffing" sub="Pick a shift type to edit its times, legal break, staffing levels and the service roles it needs." />
      <SetupEditor store={{ id: store.id, name: store.name, openingHours: store.openingHours, shiftTemplates: store.shiftTemplates }} roles={roles} />
    </>
  );
}
