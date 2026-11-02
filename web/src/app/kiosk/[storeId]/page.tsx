import { requireKiosk } from "@/lib/auth";
import { isDemo } from "@/lib/db";
import { getDict } from "@/lib/lang";
import { hasFeature } from "@/lib/roles";
import { kioskBoard } from "@/lib/timesheets";
import { Kiosk } from "./kiosk";

export const dynamic = "force-dynamic";

/** The site's shared clock-in screen: a tablet by the door, opened by a manager. */
export default async function KioskPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const { store } = await requireKiosk(storeId);
  const { lang, t } = await getDict();
  if (!hasFeature(store.features, "clockIn")) {
    return <main className="grid min-h-screen place-items-center p-6 text-center text-zinc-600">Clocking in is switched off for {store.name}.</main>;
  }
  return <Kiosk storeId={storeId} storeName={store.name} timeZone={store.timezone} initial={await kioskBoard(store)} lang={lang} t={t} demo={isDemo()} />;
}
