import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Notice } from "@/components/ui";
import { availabilityFor } from "@/lib/availability";
import { can, requireStore } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { orgStores, staffRecords, storeStaff } from "@/lib/org";
import { storeRoles } from "@/lib/team";
import { templateColor } from "@/lib/colors";
import { db } from "@/lib/db";
import { addDays, coversShift, dayDate, isMonday, mondayOf, nextMonday, prettyDate, parseDate, shiftsForStore, toMin, weekLabel } from "@/lib/time";
import { DAYS } from "@/lib/types";
import { DAYS_PER_WEEK, dailyHours, holidayDatesInWeek } from "@/lib/holidays";
import { liveAssignments, lockState } from "@/lib/live";
import { zonedNow } from "@/lib/zone";
import { rateFor } from "@/lib/pay";
import { shiftLabel } from "@/lib/swaps";
import { unlockRota } from "./actions";
import { RotaAssistant } from "./assistant";
import { RotaEditor } from "./editor";

export default async function RotaPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ week?: string }> }) {
  const { storeId } = await params;
  const { week: w } = await searchParams;
  const access = await requireStore(storeId, ["rota.view", "rota.edit", "rota.publish"]);
  const { store } = access;
  const canEdit = can(access, "rota.edit");
  const canPublish = can(access, "rota.publish");
  const d = await db();
  const [rotas, employees] = await Promise.all([d.list("rotas", { storeId }), storeStaff(store)]);
  const { avail, holidays: approvedHolidays } = await staffRecords(employees);
  const sites = store.orgId ? Object.fromEntries((await orgStores(store.orgId)).map((s) => [s.id, s.name])) : {};
  const week = w && isMonday(w) ? w : rotas.find((r) => r.weekStart === mondayOf())?.status === "approved" ? nextMonday() : mondayOf();
  const rota = rotas.find((r) => r.weekStart === week) ?? null;
  const shifts = shiftsForStore(store);
  const av = availabilityFor(avail, week);
  // Approved holiday: off those days, and contract reduced by a day's worth per holiday day.
  const holidays = approvedHolidays;
  const holidayDays: Record<string, string[]> = {};
  for (const e of employees) {
    const off = [...holidayDatesInWeek(holidays, e.id, week)];
    if (!off.length) continue;
    holidayDays[e.id] = off;
    if (av[e.id]) {
      av[e.id] = { ...av[e.id] };
      for (const date of off) av[e.id][DAYS[(parseDate(date).getDay() + 6) % 7]] = [];
    }
  }
  // The 24-hour rule applies once a week has been published.
  const live = rota ? liveAssignments(rota) : null;
  const lockedShifts: Record<string, "locked" | "past"> = {};
  if (live) {
    for (const s of shifts) {
      const st = lockState(week, DAYS.indexOf(s.day), s.start, zonedNow(store.timezone));
      if (st !== "open") lockedShifts[s.id] = st;
    }
  }
  const changeRequests = rota ? (await d.list("change_requests", { storeId, rotaId: rota.id })).filter((c) => c.status === "pending") : [];
  const availableFor: Record<string, string[]> = {};
  for (const s of shifts) {
    availableFor[s.id] = employees
      .filter((e) => coversShift(av[e.id]?.[s.day], s.start, s.end) && !(e.isUnder18 && (s.minutes > 480 || toMin(s.start) < 360 || toMin(s.start) + s.minutes > 1320)))
      .map((e) => e.id);
  }
  const pendingSwaps = (await d.list("swap_requests", { storeId, weekStart: week })).filter((s) => s.status === "pending_approval").length;
  const exceptions = rota?.exceptions ?? [];
  // Visiting staff are paid at their home site's rates; roles are matched by id across the group's sites.
  const roles = store.orgId ? (await Promise.all((await orgStores(store.orgId)).map((s) => storeRoles(s.id)))).flat() : await storeRoles(storeId);
  const asks = { pending: exceptions.filter((x) => x.status === "pending").length, declined: exceptions.filter((x) => x.status === "declined").length };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow mb-1">Rota</div>
          <div className="flex items-center gap-1">
            <Link href={`?week=${addDays(week, -7)}`} className="btn-ghost btn-sm px-2" aria-label="Previous week"><Icon name="left" className="size-5" /></Link>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{weekLabel(week)}</h1>
            <Link href={`?week=${addDays(week, 7)}`} className="btn-ghost btn-sm px-2" aria-label="Next week"><Icon name="right" className="size-5" /></Link>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 pl-1">
            {rota ? rota.status === "approved" ? <Badge tone="green" icon="lock">Published · v{rota.version}</Badge> : <Badge tone="amber">Draft</Badge> : <Badge>Not started</Badge>}
            {week !== mondayOf() && <Link href={`?week=${mondayOf()}`} className="text-xs font-medium text-brand-700 hover:underline">Jump to this week</Link>}
          </div>
        </div>
        {rota && (
          <div className="flex gap-2">
            {hasFeature(store.features, "print") && <Link href={`/s/${storeId}/rota/print?week=${week}`} className="btn-secondary" target="_blank"><Icon name="print" className="size-4" /><span className="hidden sm:inline">Print A4</span></Link>}
            {rota.status === "approved" && canPublish && (
              <form action={unlockRota.bind(null, storeId, week)}>
                <button className="btn-secondary"><Icon name="lock" className="size-4" />Unlock to edit</button>
              </form>
            )}
          </div>
        )}
      </div>

      {!rotas.some((r) => r.status === "approved" || r.published) && (can(access, "account.admin") || canEdit) && (
        <Notice tone="blue" icon="sparkles">
          New here? <Link href={`/s/${storeId}/start`} className="font-semibold underline">Follow the getting-started checklist</Link> to set up shifts, staff and rules.
        </Notice>
      )}
      {rota?.status === "approved" && (
        <Notice tone="green">
          Published by {rota.approvedBy} on {prettyDate(rota.approvedAt!.slice(0, 10))}. Staff can see it and offer swaps, and any change needs your approval.
          {pendingSwaps > 0 && <> <Link href={`/s/${storeId}/approvals`} className="font-semibold underline">{pendingSwaps} swap{pendingSwaps > 1 ? "s" : ""} waiting.</Link></>}
          {asks.pending > 0 && <> {asks.pending} outside-availability ask{asks.pending > 1 ? "s" : ""} waiting for staff to agree.</>}
        </Notice>
      )}
      {changeRequests.length > 0 && (
        <Notice tone="blue" icon="swap">
          <p className="font-medium">Waiting for staff to accept {changeRequests.length} change{changeRequests.length > 1 ? "s" : ""} within 24 hours:</p>
          <ul className="mt-1 list-disc pl-5">
            {changeRequests.map((c) => (
              <li key={c.id}>{employees.find((e) => e.id === c.employeeId)?.name ?? "Someone"}: {c.kind === "add" ? "add to" : "remove from"} {shiftLabel(store, rota!, c.shiftId)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {asks.declined > 0 && (
        <Notice tone="red">
          {asks.declined} person{asks.declined > 1 ? "s" : ""} declined a shift outside their availability. Unlock the week and reassign {asks.declined > 1 ? "them" : "it"}.
        </Notice>
      )}

      <RotaEditor
        key={rota?.status === "approved" ? `${week}-approved-${rota.version}` : `${week}-draft`}
        storeId={storeId}
        week={week}
        days={DAYS.filter((day) => shifts.some((s) => s.day === day)).map((day) => ({ day, date: dayDate(week, day) }))}
        templates={store.shiftTemplates.map((t, i) => ({ id: t.id, name: t.name, start: t.start, end: t.end, color: templateColor(t, i) }))}
        shifts={shifts}
        roleInfo={Object.fromEntries(roles.map((r) => [r.id, { name: r.name, color: r.color }]))}
        lockedShifts={lockedShifts}
        holidayDays={holidayDays}
        employees={employees.map((e) => ({ id: e.id, name: e.name, visitingFrom: e.visiting ? sites[e.storeId] ?? "another site" : null, roleIds: e.roleIds ?? [], role: e.role, contractedHours: e.visiting ? 0 : Math.max(0, Math.round((e.contractedHours - dailyHours(e) * Math.min(DAYS_PER_WEEK, holidayDays[e.id]?.length ?? 0)) * 10) / 10), maxHoursPerWeek: e.maxHoursPerWeek, isUnder18: e.isUnder18, isStudent: e.isStudent, hasAvailability: !!av[e.id] }))}
        availableFor={availableFor}
        initial={rota?.assignments ?? []}
        initialExceptions={exceptions}
        status={rota?.status ?? null}
        hasRota={!!rota}
        canEdit={canEdit}
        canPublish={canPublish}
        outOfHours={hasFeature(store.features, "outOfHours")}
        dayView={hasFeature(store.features, "dayView")}
        prevWeek={addDays(week, -7)}
        templates2={(await d.list("rota_templates", { storeId })).map((t) => ({ id: t.id, name: t.name }))}
        labour={
          hasFeature(store.features, "labourCost") && can(access, "pay.view")
            ? { rates: Object.fromEntries(employees.map((e) => [e.id, rateFor(e, roles)])), budget: store.weeklyLabourBudget ?? null }
            : null
        }
      />
      {hasFeature(store.features, "assistant") && (can(access, "rota.edit") || can(access, "rules.manage") || can(access, "account.admin")) && (
        <RotaAssistant storeId={storeId} week={week} weekLabel={weekLabel(week)} canRules={can(access, "rules.manage")} />
      )}
    </>
  );
}
