import Link from "next/link";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { Badge } from "@/components/ui";
import { getDict } from "@/lib/lang";
import { pendingApprovals } from "@/lib/approvals";
import { can, requireStore, storeActive } from "@/lib/auth";
import { isDemo } from "@/lib/db";
import { allowedSections } from "@/lib/nav";
import { hasFeature } from "@/lib/roles";
import { solverHealthy } from "@/lib/solver";
import { logout } from "../../login/actions";
import { AccountMenu, BottomNav, TopNav } from "./nav";
import { orgOf } from "@/lib/org";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId);
  const { store, actor, employee } = access;
  const [pending, healthy] = await Promise.all([pendingApprovals(storeId), solverHealthy()]);
  // Only count what this person can actually approve.
  const badge =
    (can(access, "approvals.swaps") && hasFeature(store.features, "swaps") ? pending.swaps.length : 0) +
    (can(access, "approvals.availability") ? pending.availability.length : 0) +
    (can(access, "rota.publish") ? pending.declined.length : 0) +
    (can(access, "approvals.holiday") && hasFeature(store.features, "holidays") ? pending.holidays.length : 0) +
    (can(access, "approvals.swaps") && hasFeature(store.features, "openShifts") ? pending.openShifts.length : 0);
  const allowed = allowedSections(access.perms);
  const { lang, t } = await getDict();
  const navLabels = Object.fromEntries(["rota", "approvals", "timesheets", "staff", "reports", "rules", "setup", "admin", "settings", "more"].map((k) => [k, t[`nav.${k}` as keyof typeof t]]));
  const active = storeActive(store);
  const org = await orgOf(store);

  return (
    <div className="min-h-screen pb-24 md:pb-10">
      <header className="no-print sticky top-0 z-30 border-b border-zinc-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link href={employee ? "/me" : `/s/${storeId}`} className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white" aria-label="Home">
            <Icon name="calendar" className="size-4" />
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 text-[15px]">
            {org && !employee && (
              <>
                <Link href={`/org/${org.id}`} className="hidden shrink-0 font-medium text-zinc-500 hover:text-zinc-900 sm:inline" title="All sites">{org.name}</Link>
                <span className="hidden text-zinc-300 sm:inline">/</span>
              </>
            )}
            <span className="truncate font-semibold" title={store.name}>{store.name}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!healthy && <Badge tone="red" icon="alert">Solver offline</Badge>}
            {employee && <Link href="/me" className="btn-secondary btn-sm"><Icon name="left" className="size-4" /><span className="hidden sm:inline">{t.myShifts}</span></Link>}
            <AccountMenu name={employee?.name ?? actor} sub={employee ? store.name : org ? `${org.name}` : undefined}>
              <label className="mb-2 block px-2 text-xs text-zinc-500">
                {t.language}
                <span className="mt-1 block"><LanguagePicker lang={lang} label={t.language} full /></span>
              </label>
              {org && !employee && (
                <Link href={`/org/${org.id}`} className="flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-zinc-100"><Icon name="grid" className="size-4 text-zinc-500" />All sites</Link>
              )}
              <form action={logout}>
                <button className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-zinc-100"><Icon name="logout" className="size-4 text-zinc-500" />{t.signOut}</button>
              </form>
            </AccountMenu>
          </div>
        </div>
        <TopNav storeId={storeId} pending={badge} allowed={allowed} labels={navLabels} />
      </header>
      {!active && can(access, "account.billing") && (
        <div className="no-print border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-sm text-amber-900">
          {store.cancelledAt ? "This location's subscription is cancelled. Data is deleted 30 days after cancelling." : "Your free trial has ended."}{" "}
          <Link href={`/s/${storeId}/settings#billing`} className="font-semibold underline">Manage billing</Link>
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-8">{children}</main>
      <BottomNav storeId={storeId} pending={badge} allowed={allowed} labels={navLabels} />
    </div>
  );
}
