import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { audit } from "@/lib/audit";
import { DEFAULT_FEATURES, ROLE_PRESETS } from "@/lib/roles";
import { applyRolePreset, ensureSystemRoles } from "@/lib/team";
import { requireManager } from "@/lib/auth";
import { db, newId, now } from "@/lib/db";
import { addDays, isoDate } from "@/lib/time";
import { DAYS, type Store } from "@/lib/types";
import { logout } from "../login/actions";

export const dynamic = "force-dynamic";

async function createStore(form: FormData) {
  "use server";
  const s = await requireManager();
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  const d = await db();
  let joinCode = "";
  do {
    joinCode = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  } while ((await d.list("stores", { joinCode })).length);
  const hours = { open: "10:00", close: "23:00" };
  const store: Store = {
    id: newId(),
    ownerId: s.userId,
    name,
    timezone: "Europe/London",
    openingHours: Object.fromEntries(DAYS.map((day) => [day, hours])) as Store["openingHours"],
    shiftTemplates: [
      { id: "open", name: "Open", start: "10:00", end: "16:00", days: [...DAYS], minStaff: 2, maxStaff: 4 },
      { id: "close", name: "Close", start: "16:00", end: "23:00", days: [...DAYS], minStaff: 3, maxStaff: 5 },
    ],
    joinCode,
    plan: "trial",
    billingStatus: "trialing",
    trialEndsAt: addDays(isoDate(new Date()), 30),
    cancelledAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    features: { ...DEFAULT_FEATURES },
    createdAt: now(),
  };
  await d.insert("stores", store);
  // The person creating the location is its Account Primary.
  await d.insert("store_members", { id: newId(), storeId: store.id, userId: s.userId, email: s.email, role: "owner", roleIds: [] });
  const preset = String(form.get("preset") ?? "restaurant");
  await applyRolePreset(store.id, ROLE_PRESETS.some((p) => p.key === preset) ? preset : "restaurant");
  await ensureSystemRoles(store.id);
  await audit(store.id, s.email, "store.created", { name, rolePreset: preset });
  redirect(`/s/${store.id}/setup`);
}

export default async function StoresPage() {
  const s = await requireManager();
  const d = await db();
  const memberships = await d.list("store_members", { userId: s.userId });
  const orgMemberships = await d.list("org_members", { userId: s.userId });
  const orgs = (await Promise.all(orgMemberships.map((m) => d.get("organisations", m.orgId)))).filter((x) => !!x);
  // Sites that belong to a group are reached through the group dashboard.
  const stores = (await Promise.all(memberships.map((m) => d.get("stores", m.storeId)))).filter((x): x is Store => !!x && !orgs.some((o) => o!.id === x.orgId));
  if (orgs.length === 1 && !stores.length) redirect(`/org/${orgs[0]!.id}`);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader
        title="Your locations"
        sub={`Signed in as ${s.email}`}
        actions={
          <form action={logout}>
            <button className="btn-ghost">Sign out</button>
          </form>
        }
      />
      <div className="space-y-3">
        {orgs.map((o) => (
          <Link key={o!.id} href={`/org/${o!.id}`} className="card flex items-center justify-between hover:border-brand-500">
            <div>
              <p className="font-medium">{o!.name}</p>
              <p className="text-sm text-zinc-500">Group dashboard · all sites</p>
            </div>
            <span className="text-brand-700">Open →</span>
          </Link>
        ))}
        {stores.map((st) => (
          <Link key={st.id} href={`/s/${st.id}/rota`} className="card flex items-center justify-between hover:border-brand-500">
            <div>
              <p className="font-medium">{st.name}</p>
              <p className="text-sm text-stone-500">Staff code {st.joinCode} · {st.shiftTemplates.length} shift types</p>
            </div>
            <span className="text-brand-600">Open →</span>
          </Link>
        ))}
      </div>
      <form action={createStore} className="card mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <label className="label" htmlFor="name">Add a location</label>
          <input id="name" name="name" placeholder="e.g. Test Wings, Leeds" className="input" required />
        </div>
        <div className="min-w-44">
          <label className="label" htmlFor="preset">Type of business</label>
          <select id="preset" name="preset" className="input" defaultValue="restaurant">
            {ROLE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
        <button className="btn-primary">Create</button>
      </form>
    </main>
  );
}
