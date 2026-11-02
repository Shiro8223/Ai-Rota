import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { requireStore } from "@/lib/auth";
import { allowedSections, NAV } from "@/lib/nav";

/** Phone "More" tab: every section this person can open. */
export default async function MorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId);
  const allowed = allowedSections(access.perms);
  return (
    <>
      <PageHeader title="More" />
      <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
        {NAV.filter((l) => allowed.includes(l.seg)).map((l) => (
          <Link key={l.seg} href={`/s/${storeId}/${l.seg}`} className="flex items-center gap-3 px-4 py-4 hover:bg-zinc-50">
            <span className="grid size-9 place-items-center rounded-xl bg-zinc-100 text-zinc-700"><Icon name={l.icon} className="size-5" /></span>
            <span className="flex-1 font-medium">{l.label}</span>
            <Icon name="right" className="size-4 text-zinc-300" />
          </Link>
        ))}
      </div>
    </>
  );
}
