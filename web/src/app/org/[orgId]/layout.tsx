import Link from "next/link";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { Badge } from "@/components/ui";
import { isDemo } from "@/lib/db";
import { getDict } from "@/lib/lang";
import { requireOrg } from "@/lib/org-admin";
import { logout } from "../../login/actions";

export const dynamic = "force-dynamic";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, isOwner, member, actor } = await requireOrg(orgId);
  const { lang, t } = await getDict();
  const canBrand = isOwner || member.permissions.includes("account.admin");
  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:h-16">
          <Link href={`/org/${orgId}`} className="flex min-w-[7rem] items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-white"><Icon name="grid" className="size-4" /></span>
            <span className="max-w-[14rem] truncate text-[15px] font-semibold">{org.name}</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href={`/org/${orgId}`} className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-zinc-600 hover:text-zinc-900"><Icon name="calendar" className="size-4" />Dashboard</Link>
            {(isOwner || member.permissions.includes("reports.view")) && <Link href={`/org/${orgId}/reports`} className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-zinc-600 hover:text-zinc-900"><Icon name="bars" className="size-4" /><span className="hidden sm:inline">Reports</span></Link>}
            {canBrand && <Link href={`/org/${orgId}/brand`} className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-medium text-zinc-600 hover:text-zinc-900"><Icon name="shield" className="size-4" />Brand &amp; sites</Link>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {isDemo() && <span className="hidden sm:inline"><Badge tone="blue">Demo</Badge></span>}
            <LanguagePicker lang={lang} label={t.language} />
            <span className="hidden text-sm text-zinc-500 2xl:inline">{actor}</span>
            <form action={logout}><button className="btn-ghost btn-sm" aria-label={t.signOut}><Icon name="logout" className="size-4" /></button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-8">{children}</main>
    </div>
  );
}
