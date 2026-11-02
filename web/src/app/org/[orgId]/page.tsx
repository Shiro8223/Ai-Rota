import Link from "next/link";
import { Icon } from "@/components/icons";
import { Avatar, Badge, EmptyState, PageHeader } from "@/components/ui";
import { pendingApprovals } from "@/lib/approvals";
import { db } from "@/lib/db";
import { holidayDatesInWeek } from "@/lib/holidays";
import { liveAssignments } from "@/lib/live";
import { storeStaff } from "@/lib/org";
import { requireOrg } from "@/lib/org-admin";
import { checkRota } from "@/lib/solver";
import { complianceFlags } from "@/lib/compliance";
import { storeRoles } from "@/lib/team";
import { addDays, hours, mondayOf, prettyDate, shiftsForStore, weekLabel } from "@/lib/time";
import type { Rota } from "@/lib/types";

export const dynamic = "force-dynamic";

function RotaPill({ rota }: { rota: Rota | undefined }) {
  if (!rota) return <Badge tone="red">Not started</Badge>;
  if (rota.status === "approved") return <Badge tone="green" icon="lock">Published</Badge>;
  return rota.published ? <Badge tone="amber">Being edited</Badge> : <Badge tone="amber">Draft</Badge>;
}

/** Group owner's view: every site at a glance, and one inbox for everything waiting. */
export default async function OrgDashboard({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, sites } = await requireOrg(orgId);
  const d = await db();
  const week = mondayOf();
  const next = addDays(week, 7);

  const cards = await Promise.all(
    sites.map(async (site) => {
      const [rotas, staff, pending, holidays] = await Promise.all([d.list("rotas", { storeId: site.id }), storeStaff(site), pendingApprovals(site.id), d.list("holidays", { storeId: site.id, status: "approved" })]);
      const own = staff.filter((e) => !e.visiting);
      const thisRota = rotas.find((r) => r.weekStart === week);
      const nextRota = rotas.find((r) => r.weekStart === next);
      const shifts = Object.fromEntries(shiftsForStore(site).map((s) => [s.id, s]));
      const live = thisRota ? liveAssignments(thisRota) ?? thisRota.assignments : [];
      const scheduled = live.reduce((n, a) => n + (shifts[a.shiftId]?.minutes ?? 0), 0);
      const contracted = own.reduce((n, e) => n + e.contractedHours * 60, 0);
      let problems: number | null = null;
      let blocking = 0;
      if (thisRota) {
        try {
          const issues = (await checkRota(site, week, live, thisRota.exceptions ?? [])).issues.filter((i) => i.severity === "error");
          problems = issues.length;
          blocking = issues.filter((i) => i.legal || i.blocking).length;
        } catch {
          problems = null;
        }
      }
      const flags = complianceFlags(own.filter((e) => e.active), await storeRoles(site.id));
      const offThisWeek = own.filter((e) => holidayDatesInWeek(holidays, e.id, week).size > 0);
      return { site, own, visiting: staff.length - own.length, thisRota, nextRota, scheduled, contracted, problems, blocking, pending, offThisWeek, flags };
    }),
  );

  const empNames = Object.fromEntries((await Promise.all(sites.map((s) => d.list("employees", { storeId: s.id })))).flat().map((e) => [e.id, e.name]));
  const inbox = cards.flatMap(({ site, pending }) => [
    ...pending.swaps.map((x) => ({ site, kind: "Shift swap", who: empNames[x.toEmployeeId ?? ""] ?? "", what: `takes ${empNames[x.fromEmployeeId] ?? "a colleague"}'s shift`, at: x.createdAt })),
    ...pending.availability.map((x) => ({ site, kind: x.kind === "temporary" ? "Temporary availability" : "Availability change", who: empNames[x.employeeId] ?? "", what: x.note || "usual pattern", at: x.updatedAt })),
    ...pending.holidays.map((x) => ({ site, kind: "Holiday", who: empNames[x.employeeId] ?? "", what: `${prettyDate(x.startDate)} – ${prettyDate(x.endDate)} · ${x.paid ? "paid" : "unpaid"}`, at: x.createdAt })),
    ...pending.declined.map(({ x }) => ({ site, kind: "Declined shift", who: empNames[x.employeeId] ?? "", what: "outside availability: reassign", at: x.respondedAt ?? x.requestedAt })),
  ]).sort((a, b) => a.at.localeCompare(b.at));

  const compliance = cards.flatMap(({ site, flags }) => flags.map((f) => ({ site, f }))).sort((a, b) => (a.f.severity === b.f.severity ? 0 : a.f.severity === "error" ? -1 : 1));
  const totals = {
    staff: cards.reduce((n, c) => n + c.own.length, 0),
    waiting: inbox.length,
    blocking: cards.reduce((n, c) => n + c.blocking, 0),
    unpublishedNext: cards.filter((c) => c.nextRota?.status !== "approved").length,
  };

  return (
    <>
      <PageHeader eyebrow="Group dashboard" title={org.name} sub={`Week of ${weekLabel(week)}. ${sites.length} site${sites.length === 1 ? "" : "s"}.`} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Staff across sites", value: totals.staff, tone: "" },
          { label: "Waiting for approval", value: totals.waiting, tone: totals.waiting ? "text-amber-700" : "" },
          { label: "Legal / contract problems this week", value: totals.blocking, tone: totals.blocking ? "text-red-600" : "text-emerald-700" },
          { label: "Sites without next week published", value: totals.unpublishedNext, tone: totals.unpublishedNext ? "text-amber-700" : "text-emerald-700" },
        ].map((k) => (
          <div key={k.label} className="card p-4 sm:p-4">
            <p className="text-xs text-zinc-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cards.map((c) => {
          const pct = c.contracted ? Math.round((c.scheduled / c.contracted) * 100) : 0;
          return (
            <section key={c.site.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{c.site.name}</h2>
                  <p className="text-sm text-zinc-500">{c.own.length} staff{c.visiting ? ` + ${c.visiting} visiting` : ""} · code {c.site.joinCode}</p>
                </div>
                <Link href={`/s/${c.site.id}/rota`} className="btn-secondary btn-sm">Open<Icon name="right" className="size-4" /></Link>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">This week</dt><dd className="mt-1"><RotaPill rota={c.thisRota} /></dd></div>
                <div className="rounded-md bg-zinc-50 p-3"><dt className="text-xs text-zinc-500">Next week</dt><dd className="mt-1"><RotaPill rota={c.nextRota} /></dd></div>
                <div className="rounded-md bg-zinc-50 p-3">
                  <dt className="text-xs text-zinc-500">Rule check this week</dt>
                  <dd className={`mt-1 font-semibold ${c.blocking ? "text-red-600" : c.problems ? "text-amber-700" : "text-emerald-700"}`}>
                    {c.problems === null ? (c.thisRota ? "Solver offline" : "No rota") : c.problems === 0 ? "All rules met" : `${c.problems} problem${c.problems > 1 ? "s" : ""}${c.blocking ? ` (${c.blocking} legal/contract)` : ""}`}
                  </dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-3">
                  <dt className="text-xs text-zinc-500">Hours vs contracts</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{hours(c.scheduled)} <span className="font-normal text-zinc-500">/ {hours(c.contracted)} ({pct}%)</span></dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {c.pending.total > 0 ? (
                  <Link href={`/s/${c.site.id}/approvals`} className="flex items-center gap-1.5 font-medium text-amber-800 hover:underline"><Icon name="inbox" className="size-4" />{c.pending.total} waiting for approval</Link>
                ) : (
                  <span className="text-zinc-500">Nothing waiting</span>
                )}
                {c.offThisWeek.length > 0 && <span className="text-zinc-500">· On holiday: {c.offThisWeek.map((e) => e.name.split(" ")[0]).join(", ")}</span>}
              </div>
            </section>
          );
        })}
        {!cards.length && <EmptyState title="No sites you can see yet" icon="grid">Ask the group owner for access, or add a site under Brand &amp; sites.</EmptyState>}
      </div>

      <section className="mt-8">
        <h2 className="eyebrow mb-3">People compliance · {compliance.length}</h2>
        <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
          {compliance.slice(0, 25).map(({ site, f }, i) => (
            <Link key={i} href={`/s/${site.id}/staff/${f.employeeId}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-6">
              <Badge tone={f.severity === "error" ? "red" : "amber"} icon="alert">{f.kind === "wage" ? "Minimum wage" : f.kind === "rtw" ? "Right to work" : "Qualification"}</Badge>
              <span className="min-w-0 flex-1 text-sm">{f.message}</span>
              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{site.name}</span>
            </Link>
          ))}
          {compliance.length > 25 && <p className="px-4 py-3 text-sm text-zinc-500 sm:px-6">+{compliance.length - 25} more on each site&apos;s Staff page.</p>}
          {!compliance.length && <p className="px-4 py-5 text-sm text-zinc-500 sm:px-6">Pay, right-to-work and qualification records are all in order.</p>}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="eyebrow mb-3">Waiting for approval across all sites · {inbox.length}</h2>
        <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
          {inbox.map((x, i) => (
            <Link key={i} href={`/s/${x.site.id}/approvals`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-6">
              <Avatar name={x.who || "?"} size="sm" />
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{x.who || "Someone"}</span> <span className="text-zinc-500">· {x.what}</span>
              </div>
              <Badge tone="violet">{x.kind}</Badge>
              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{x.site.name}</span>
              <Icon name="right" className="size-4 text-zinc-300" />
            </Link>
          ))}
          {!inbox.length && <p className="px-4 py-5 text-sm text-zinc-500 sm:px-6">Nothing waiting at any site.</p>}
        </div>
      </section>
    </>
  );
}
