import Link from "next/link";
import { PageHeader, Tabs } from "@/components/ui";
import { requireOrg } from "@/lib/org-admin";
import { labourCost, money } from "@/lib/pay";
import { siteReport } from "@/lib/reports";
import { db } from "@/lib/db";
import { liveAssignments } from "@/lib/live";
import { storeRoles } from "@/lib/team";
import { addDays, hours, mondayOf, shiftsForStore } from "@/lib/time";
import { notFound } from "next/navigation";

const RANGES = { "4": "Last 4 weeks", "8": "Last 8 weeks", "13": "Last quarter" } as const;

/** Every site side by side: hours, overtime, fairness, absence, holiday owed, labour cost vs budget. */
export default async function GroupReports({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ weeks?: string }> }) {
  const { orgId } = await params;
  const sp = await searchParams;
  const { sites, perms } = await requireOrg(orgId);
  if (!perms.has("reports.view")) notFound();
  const withPay = perms.has("pay.view");
  const weeks = sp.weeks && sp.weeks in RANGES ? sp.weeks : "4";
  const d = await db();
  const rows = await Promise.all(
    sites.map(async (site) => {
      const r = await siteReport(site, +weeks, withPay);
      let cost: number | null = null;
      if (withPay) {
        const [staff, roles, rotas] = await Promise.all([d.list("employees", { storeId: site.id }), storeRoles(site.id), d.list("rotas", { storeId: site.id })]);
        const shifts = Object.fromEntries(shiftsForStore(site).map((s) => [s.id, s]));
        const inRange = rotas.filter((x) => x.weekStart >= r.start && x.weekStart <= r.end).flatMap((x) => liveAssignments(x) ?? []);
        cost = labourCost(inRange, shifts, staff, roles).total;
      }
      const budget = site.weeklyLabourBudget ? site.weeklyLabourBudget * +weeks : null;
      return { site, r, cost, budget };
    }),
  );
  const unfair = (p: { closes: number; weekends: number }, avg: { c: number; w: number }) => (avg.c && p.closes >= avg.c * 1.5 && p.closes - avg.c >= 2) || (avg.w && p.weekends >= avg.w * 1.5 && p.weekends - avg.w >= 2);

  return (
    <>
      <PageHeader eyebrow="Group reports" title="All sites" sub={`${rows[0]?.r.start ?? addDays(mondayOf(), -7 * +weeks)} to ${rows[0]?.r.end ?? addDays(mondayOf(), -1)}`} />
      <Tabs active={weeks} items={Object.entries(RANGES).map(([k, label]) => ({ key: k, label, href: `?weeks=${k}` }))} />
      <div className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[860px]">
          <thead>
            <tr>
              <th className="th">Site</th><th className="th">Hours worked</th><th className="th">Over contract</th><th className="th">Sick days</th>
              <th className="th">Uneven closes / weekends</th>{withPay && <th className="th">Labour cost</th>}{withPay && <th className="th">Holiday owed</th>}<th className="th" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ site, r, cost, budget }) => {
              const uneven = r.people.filter((p) => unfair(p, { c: r.avgCloses, w: r.avgWeekends })).length;
              return (
                <tr key={site.id}>
                  <td className="td font-medium">{site.name}</td>
                  <td className="td tabular-nums">{hours(r.totals.worked)}</td>
                  <td className="td tabular-nums">{hours(r.totals.overtime)}</td>
                  <td className="td tabular-nums">{r.totals.sick}</td>
                  <td className={`td tabular-nums ${uneven ? "font-semibold text-amber-700" : ""}`}>{uneven ? `${uneven} people` : "Even"}</td>
                  {withPay && <td className={`td tabular-nums ${budget && cost! > budget ? "font-semibold text-red-600" : ""}`}>{money(cost ?? 0)}{budget ? <span className="text-xs font-normal text-zinc-500"> / {money(budget)}</span> : null}</td>}
                  {withPay && <td className="td tabular-nums">{money(r.totals.liability ?? 0)}</td>}
                  <td className="td text-right"><Link href={`/s/${site.id}/reports?weeks=${weeks}`} className="btn-ghost btn-sm">Details</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-zinc-500">Labour cost = paid hours on published rotas × hourly rate, before employer NI and pension. Budget = the site&apos;s weekly budget × weeks.</p>
    </>
  );
}
