import Link from "next/link";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { Badge } from "@/components/ui";
import { isDemo } from "@/lib/db";
import { getDict } from "@/lib/lang";
import { requireOrg } from "@/lib/org-admin";
import { logout } from "../../login/actions";
import { AccountMenu } from "../../s/[storeId]/nav";
import { OrgMenu, OrgTabs, type OrgLink } from "./nav";

export const dynamic = "force-dynamic";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, isOwner, member, actor, sites } = await requireOrg(orgId);
  const { lang, t } = await getDict();
  const canBrand = isOwner || member.permissions.includes("account.admin");
  const home = `/org/${orgId}`;
  const links: OrgLink[] = [
    { href: home, label: "Dashboard", icon: "grid" },
    ...(isOwner || member.permissions.includes("reports.view") ? [{ href: `${home}/reports`, label: "Reports", icon: "bars" as const }] : []),
    ...(canBrand ? [{ href: `${home}/brand`, label: "Brand & sites", icon: "shield" as const }] : []),
  ];
  const account = (
    <>
      <label className="mb-2 block px-3 text-xs text-zinc-500">
        {t.language}
        <span className="mt-1 block"><LanguagePicker lang={lang} label={t.language} full /></span>
      </label>
      <form action={logout}>
        <button className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] text-zinc-700 hover:bg-zinc-50"><Icon name="logout" className="size-5 text-zinc-400" />{t.signOut}</button>
      </form>
    </>
  );
  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link href={home} className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-white"><Icon name="grid" className="size-4" /></span>
            <span className="truncate text-[15px] font-semibold">{org.name}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {isDemo() && <Badge tone="blue">Demo</Badge>}
            <div className="hidden md:block"><AccountMenu name={actor} sub={org.name}>{account}</AccountMenu></div>
            <OrgMenu links={links} home={home} sites={sites.map((s) => ({ id: s.id, name: s.name }))} who={actor} extra={account} />
          </div>
        </div>
        <OrgTabs links={links} home={home} />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
