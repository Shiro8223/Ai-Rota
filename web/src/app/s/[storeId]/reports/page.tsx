import Link from "next/link";
import { PageHeader, Tabs } from "@/components/ui";
import { can, requireStore } from "@/lib/auth";
import { money } from "@/lib/pay";
import { siteReport } from "@/lib/reports";
import { hours, prettyDate } from "@/lib/time";

const RANGES = { "4": "Last 4 weeks", "8": "Last 8 weeks", "13": "Last quarter" } as const;

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ weeks?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const access = await requireStore(storeId, "reports.view");
  const weeks = sp.weeks && sp.weeks in RANGES ? sp.weeks : "4";
  const withPay = can(access, "pay.view");
  const r = await siteReport(access.store, +weeks, withPay);
  const peakRole = Math.max(1, ...r.byRole.map(([, m]) => m));
  const flag = (v: number, avg: number) => (avg > 0 && v >= avg * 1.5 && v - avg >= 2 ? "font-semibold text-amber-700" : "");

  return (
    <>
      <PageHeader title="Reports" sub={`${prettyDate(r.start, { day: "numeric", month: "short" })} – ${prettyDate(r.end, { day: "numeric", month: "short", year: "numeric" })}. From published rotas${access.store.features.clockIn === false ? "" : " and the approved shift log"}.`} actions={<Link href={`/api/reports/${storeId}?weeks=${weeks}`} className="btn-secondary">Download CSV</Link>} />
      <Tabs active={weeks} items={Object.entries(RANGES).map(([k, label]) => ({ key: k, label, href: `?weeks=${k}` }))} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Hours worked", value: hours(r.totals.worked) },
          { label: "Hours over contract", value: hours(r.totals.overtime) },
          { label: "Sick days", value: String(r.totals.sick) },
          { label: "Holiday still owed", value: r.totals.liability != null ? money(r.totals.liability) : "Needs pay permission" },
        ].map((k) => (
          <div key={k.label} className="card p-4 sm:p-4">
            <p className="text-xs text-zinc-500">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <section className="card mb-6">
        <h2 className="mb-3 font-semibold">Hours by job</h2>
        <ul className="space-y-2">
          {r.byRole.map(([name, m]) => (
            <li key={name} className="grid grid-cols-[8rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm">
              <span className="truncate">{name}</span>
              <span className="h-2.5 rounded-sm bg-zinc-100"><span className="block h-full rounded-sm bg-brand-500" style={{ width: `${(m / peakRole) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{hours(m)}</span>
            </li>
          ))}
          {!r.byRole.length && <li className="text-sm text-zinc-500">No published shifts in this period.</li>}
        </ul>
      </section>

      <section className="card overflow-x-auto p-0 sm:p-0">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr>
              <th className="th">Person</th><th className="th">Shifts</th><th className="th">Worked</th><th className="th">Over contract</th>
              <th className="th" title={`Average ${r.avgCloses.toFixed(1)}`}>Closes</th><th className="th" title={`Average ${r.avgWeekends.toFixed(1)}`}>Weekend shifts</th>
              <th className="th">Sick days</th><th className="th">Holiday left</th>{withPay && <th className="th">Holiday owed</th>}
            </tr>
          </thead>
          <tbody>
            {r.people.map((p) => (
              <tr key={p.id}>
                <td className="td font-medium"><Link href={`/s/${storeId}/staff/${p.id}`} className="hover:underline">{p.name}</Link></td>
                <td className="td tabular-nums">{p.shifts}</td>
                <td className="td tabular-nums">{hours(p.workedMin)}</td>
                <td className={`td tabular-nums ${p.overtimeMin > 0 ? "text-sky-700" : "text-zinc-400"}`}>{p.overtimeMin ? hours(p.overtimeMin) : "–"}</td>
                <td className={`td tabular-nums ${flag(p.closes, r.avgCloses)}`}>{p.closes}</td>
                <td className={`td tabular-nums ${flag(p.weekends, r.avgWeekends)}`}>{p.weekends}</td>
                <td className={`td tabular-nums ${p.sickDays >= 3 ? "font-semibold text-red-700" : ""}`}>{p.sickDays || "–"}</td>
                <td className="td tabular-nums">{p.holidayLeft} {p.holidayUnit}</td>
                {withPay && <td className="td tabular-nums">{p.liability != null ? money(p.liability) : "No rate"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-3 text-xs text-zinc-500">Amber = at least 1.5× the team average, a sign the closes or weekends aren&apos;t shared fairly. Over contract counts each week&apos;s hours above that person&apos;s contract.</p>
    </>
  );
}
