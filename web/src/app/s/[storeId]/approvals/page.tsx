import Link from "next/link";
import { Icon } from "@/components/icons";
import { Avatar, Badge, EmptyState, IssueList, Notice, PageHeader, Tabs } from "@/components/ui";
import { pendingApprovals } from "@/lib/approvals";
import { can, requireStore } from "@/lib/auth";
import { holidayBalance } from "@/lib/holiday-server";
import { liveAssignments } from "@/lib/live";
import { hasFeature } from "@/lib/roles";
import { colorOf } from "@/lib/colors";
import { db } from "@/lib/db";
import { tempRange, windowsText } from "@/lib/format";
import { shiftLabel } from "@/lib/swaps";
import { coversShift, dayDate, isoDate, mondayOf, prettyDate, shiftsForStore } from "@/lib/time";
import { DAY_LABEL, DAYS, type SwapStatus } from "@/lib/types";
import { cancelOpenShiftAction, decideAvailabilityAction, decideHolidayAction, decideOpenShiftAction, decideSwapAction, postOpenShiftAction } from "./actions";
import { storeRoles } from "@/lib/team";

const SWAP_TONE: Record<SwapStatus, "green" | "amber" | "red" | "grey" | "blue"> = { open: "blue", pending_approval: "amber", approved: "green", declined: "red", cancelled: "grey" };
const SWAP_LABEL: Record<SwapStatus, string> = { open: "Looking for cover", pending_approval: "Needs approval", approved: "Approved", declined: "Declined", cancelled: "Cancelled" };

export default async function ApprovalsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ error?: string; tab?: string }> }) {
  const { storeId } = await params;
  const { error, tab = "inbox" } = await searchParams;
  const access = await requireStore(storeId, ["approvals.swaps", "approvals.availability", "approvals.holiday"]);
  const { store } = access;
  const d = await db();
  const all = await pendingApprovals(storeId);
  const swapsOn = can(access, "approvals.swaps") && hasFeature(store.features, "swaps");
  const availOn = can(access, "approvals.availability");
  const holidayOn = can(access, "approvals.holiday") && hasFeature(store.features, "holidays");
  const openOn = can(access, "approvals.swaps") && hasFeature(store.features, "openShifts");
  const pending = {
    swaps: swapsOn ? all.swaps : [],
    availability: availOn ? all.availability : [],
    declined: can(access, "rota.publish") ? all.declined : [],
    holidays: holidayOn ? [...all.holidays].sort((a, b) => a.startDate.localeCompare(b.startDate)) : [],
    openShifts: openOn ? all.openShifts : [],
    total: 0,
  };
  pending.total = pending.swaps.length + pending.availability.length + pending.declined.length + pending.holidays.length + pending.openShifts.length;
  const timesheetsWaiting = can(access, "timesheets.approve") && hasFeature(store.features, "clockIn") ? all.timesheets.length : 0;
  const stillOpen = openOn ? await d.list("open_shifts", { storeId, status: "open" }) : [];
  const postable = can(access, "rota.edit") && hasFeature(store.features, "openShifts");
  const [swaps, allAvail, employees, rotas] = await Promise.all([
    d.list("swap_requests", { storeId }, { orderBy: "createdAt", desc: true }),
    d.list("availability", { storeId }),
    d.list("employees", { storeId }),
    d.list("rotas", { storeId }),
  ]);
  const emps = Object.fromEntries(employees.map((e) => [e.id, e]));
  const rotaById = Object.fromEntries(rotas.map((r) => [r.id, r]));
  const shiftById = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  const shiftColor = Object.fromEntries(Object.values(shiftById).map((s) => [s.id, s.color]));
  const allHolidays = holidayOn ? await d.list("holidays", { storeId }) : [];
  const holidayInfo = await Promise.all(
    pending.holidays.map(async (h) => {
      const e = emps[h.employeeId];
      const b = e ? await holidayBalance(store, e, h.startDate) : null;
      // Published shifts this person has inside the requested dates.
      const clashes = rotas
        .flatMap((r) => (liveAssignments(r) ?? []).filter((a) => a.employeeId === h.employeeId && shiftById[a.shiftId]).map((a) => ({ r, s: shiftById[a.shiftId] })))
        .filter(({ r, s }) => {
          const day = dayDate(r.weekStart, s.day);
          return day >= h.startDate && day <= h.endDate;
        });
      const alsoOff = allHolidays.filter((o) => o.id !== h.id && o.employeeId !== h.employeeId && (o.status === "approved" || o.status === "pending") && o.startDate <= h.endDate && o.endDate >= h.startDate);
      return { h, e, b, clashes, alsoOff };
    }),
  );
  const jobRoles = (await storeRoles(storeId)).filter((r) => r.category === "job").map((r) => r.name);
  const waitingOnStaff = rotas.flatMap((r) => (r.exceptions ?? []).filter((x) => x.status === "pending" && r.status === "approved").map((x) => ({ r, x })));

  return (
    <>
      <PageHeader title="Approvals" sub="Nothing changes on a published rota, or in anyone's availability, until you approve it here." />
      {error && <Notice tone="red">{error}</Notice>}
      <Tabs
        active={tab}
        items={[
          { key: "inbox", label: "Waiting for you", href: "?tab=inbox", count: pending.total },
          { key: "history", label: "History", href: "?tab=history" },
        ]}
      />

      {tab === "inbox" ? (
        <div className="space-y-8">
          {pending.total === 0 && <EmptyState title="You're all caught up" icon="check">Swaps, availability changes and out-of-hours replies will appear here.</EmptyState>}

          {pending.swaps.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Shift swaps · {pending.swaps.length}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {pending.swaps.map((s) => {
                  const from = emps[s.fromEmployeeId];
                  const to = emps[s.toEmployeeId!];
                  const rota = rotaById[s.rotaId];
                  const c = colorOf(shiftColor[s.shiftId] ?? "sky");
                  return (
                    <div key={s.id} className="card">
                      <div className={`mb-4 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${c.chip} ring-1`}>
                        <span className={`size-2 rounded-full ${c.dot}`} />
                        {rota ? shiftLabel(store, rota, s.shiftId) : s.shiftId}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex min-w-0 flex-1 items-center gap-2"><Avatar name={from?.name ?? "?"} /><div className="min-w-0 text-sm"><div className="truncate font-medium">{from?.name}</div><div className="text-xs text-zinc-500">gives it up</div></div></div>
                        <Icon name="swap" className="size-5 shrink-0 text-zinc-400" />
                        <div className="flex min-w-0 flex-1 items-center gap-2"><Avatar name={to?.name ?? "?"} /><div className="min-w-0 text-sm"><div className="truncate font-medium">{to?.name}</div><div className="text-xs text-zinc-500">takes it</div></div></div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5"><Badge tone="violet">{from?.role}</Badge><Badge tone="green" icon="shield">Rule-checked</Badge></div>
                      {s.note && <p className="mt-3 text-sm text-zinc-600">“{s.note}”</p>}
                      <div className="mt-3 rounded-xl bg-zinc-50 p-3"><IssueList issues={s.ruleCheck?.issues ?? []} empty="Passes every rule and legal limit." /></div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <form action={decideSwapAction.bind(null, storeId, s.id, false)}><button className="btn-secondary w-full">Decline</button></form>
                        <form action={decideSwapAction.bind(null, storeId, s.id, true)}><button className="btn-primary w-full"><Icon name="check" className="size-4" />Approve</button></form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {timesheetsWaiting > 0 && (
            <Notice tone="blue" icon="clock">
              {timesheetsWaiting} finished shift{timesheetsWaiting > 1 ? "s" : ""} to approve. <Link href={`/s/${storeId}/timesheets?show=toApprove`} className="font-semibold underline">Open the shift log</Link>
            </Notice>
          )}

          {pending.openShifts.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Open shifts claimed · {pending.openShifts.length}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {pending.openShifts.map((o) => {
                  const who = emps[o.claimedBy!];
                  const rota = rotaById[o.rotaId];
                  const c = colorOf(shiftColor[o.shiftId] ?? "sky");
                  return (
                    <div key={o.id} className="card">
                      <div className={`mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${c.chip} ring-1`}>
                        <span className={`size-2 rounded-sm ${c.dot}`} />
                        {rota ? shiftLabel(store, rota, o.shiftId) : o.shiftId}
                      </div>
                      <div className="flex items-center gap-3">
                        <Avatar name={who?.name ?? "?"} />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="font-medium">{who?.name ?? "Someone from a sister site"}</div>
                          <div className="text-xs text-zinc-500">wants to take it · {o.reason === "sick" ? `covering ${emps[o.fromEmployeeId ?? ""]?.name ?? "a colleague"} (sick)` : "open shift"}</div>
                        </div>
                        <Badge tone="green" icon="shield">Rule-checked</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <form action={decideOpenShiftAction.bind(null, storeId, o.id, false)}><button className="btn-secondary w-full">Decline</button></form>
                        <form action={decideOpenShiftAction.bind(null, storeId, o.id, true)}><button className="btn-primary w-full"><Icon name="check" className="size-4" />Approve</button></form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {(stillOpen.length > 0 || postable) && (
            <section>
              <h2 className="eyebrow mb-3">Open shifts looking for cover · {stillOpen.length}</h2>
              <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                {stillOpen.map((o) => {
                  const rota = rotaById[o.rotaId];
                  return (
                    <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-6">
                      <span className="min-w-0 flex-1">{rota ? shiftLabel(store, rota, o.shiftId) : o.shiftId}{o.roleName && <span className="text-zinc-500"> · {o.roleName}</span>}</span>
                      <Badge tone={o.reason === "sick" ? "red" : "blue"}>{o.reason === "sick" ? `${emps[o.fromEmployeeId ?? ""]?.name.split(" ")[0] ?? "Someone"} off sick` : "Unfilled"}</Badge>
                      {postable && <form action={cancelOpenShiftAction.bind(null, storeId, o.id)}><button className="text-xs text-zinc-500 underline">Withdraw</button></form>}
                    </div>
                  );
                })}
                {postable && (
                  <form action={postOpenShiftAction.bind(null, storeId)} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)_auto] sm:px-6">
                    <select name="slot" className="input" required defaultValue="">
                      <option value="" disabled>Shift to offer…</option>
                      {rotas
                        .filter((r) => r.status === "approved" && r.weekStart >= mondayOf())
                        .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
                        .flatMap((r) => Object.values(shiftById).filter((sh) => dayDate(r.weekStart, sh.day) >= isoDate(new Date())).map((sh) => <option key={r.id + sh.id} value={`${r.id}|${sh.id}`}>{shiftLabel(store, r, sh.id)}</option>))}
                    </select>
                    <select name="roleName" className="input" defaultValue="">
                      <option value="">Any role</option>
                      {jobRoles.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input name="note" className="input" maxLength={200} placeholder="Note (optional)" />
                    <button className="btn-primary"><Icon name="plus" className="size-4" />Offer</button>
                  </form>
                )}
              </div>
            </section>
          )}

          {pending.availability.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Availability changes · {pending.availability.length}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {pending.availability.map((a) => {
                  const e = emps[a.employeeId];
                  const usual = allAvail.find((x) => x.employeeId === a.employeeId && x.kind === "default" && x.status === "approved");
                  // Published shifts this change would clash with, so nothing is approved blind.
                  const clashes = rotas
                    .filter((r) => r.status === "approved" && r.weekStart >= mondayOf() && (a.kind === "default" || (r.weekStart >= a.startWeek! && r.weekStart <= a.endWeek!)))
                    .flatMap((r) => r.assignments.filter((x) => x.employeeId === a.employeeId).map((x) => ({ r, s: shiftById[x.shiftId] })))
                    .filter(({ r, s }) => s && dayDate(r.weekStart, s.day) >= isoDate(new Date()) && !coversShift(a.days[s.day], s.start, s.end));
                  return (
                    <div key={a.id} className="card">
                      <div className="flex items-start gap-3">
                        <Avatar name={e?.name ?? "?"} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{e?.name}</span>
                            {e?.isStudent && <Badge tone="violet">Student</Badge>}
                          </div>
                          <p className="text-sm text-zinc-600">
                            {a.kind === "temporary" ? <>Temporary: <b className="font-medium text-zinc-800">{a.note || "No reason given"}</b> · {tempRange(a)}, then back to usual automatically</> : "Wants to change their usual weekly availability"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-100">
                        <table className="w-full text-sm">
                          <thead className="bg-zinc-50"><tr><th className="th py-2">Day</th><th className="th py-2">Usual now</th><th className="th py-2">Requested</th></tr></thead>
                          <tbody>
                            {DAYS.map((day) => {
                              const before = windowsText(usual?.days[day]);
                              const after = windowsText(a.days[day]);
                              return (
                                <tr key={day} className={before !== after ? "bg-amber-50/60" : ""}>
                                  <td className="td py-2 font-medium">{DAY_LABEL[day]}</td>
                                  <td className="td py-2 text-zinc-500">{before}</td>
                                  <td className={`td py-2 ${before !== after ? "font-medium text-zinc-900" : "text-zinc-500"}`}>{after}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {clashes.length > 0 && (
                        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                          <p className="flex items-center gap-1.5 font-medium"><Icon name="alert" className="size-4" />Clashes with {clashes.length} published shift{clashes.length > 1 ? "s" : ""}</p>
                          <ul className="mt-1 list-disc pl-5 text-amber-900">{clashes.map(({ r, s }) => <li key={r.id + s.id}>{shiftLabel(store, r, s.id)}</li>)}</ul>
                          <p className="mt-1 text-xs text-amber-800">If you approve, unlock those weeks and reassign these shifts. Agreed out-of-hours shifts aren&apos;t affected.</p>
                        </div>
                      )}
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <form action={decideAvailabilityAction.bind(null, storeId, a.id, false)}><button className="btn-secondary w-full">Decline</button></form>
                        <form action={decideAvailabilityAction.bind(null, storeId, a.id, true)}><button className="btn-primary w-full"><Icon name="check" className="size-4" />Approve</button></form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {holidayInfo.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Holiday requests · {holidayInfo.length}</h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {holidayInfo.map(({ h, e, b, clashes, alsoOff }) => (
                  <div key={h.id} className="card">
                    <div className="flex items-start gap-3">
                      <Avatar name={e?.name ?? "?"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{e?.name ?? "Former staff"}</span>
                          <Badge tone={h.paid ? "green" : "grey"}>{h.paid ? "Paid" : "Unpaid"}</Badge>
                        </div>
                        <p className="text-sm text-zinc-600">
                          {prettyDate(h.startDate, { weekday: "short", day: "numeric", month: "short" })} – {prettyDate(h.endDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                          {h.paid && <> · uses <b className="font-medium text-zinc-800">{h.amount} {h.unit}</b></>}
                        </p>
                        {h.note && <p className="mt-1 text-sm text-zinc-600">“{h.note}”</p>}
                      </div>
                    </div>
                    {b && (
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                        <div className="rounded-md bg-zinc-50 p-2"><p className="text-[11px] text-zinc-500">Allowance</p><p className="font-semibold">{b.allowance} {b.unit}</p></div>
                        <div className="rounded-md bg-zinc-50 p-2"><p className="text-[11px] text-zinc-500">Left now</p><p className="font-semibold">{Math.round((b.remaining + (h.paid ? h.amount : 0)) * 10) / 10}</p></div>
                        <div className="rounded-md bg-zinc-50 p-2"><p className="text-[11px] text-zinc-500">Left after</p><p className={`font-semibold ${b.remaining < 0 ? "text-red-600" : ""}`}>{b.remaining}</p></div>
                        <p className="col-span-3 text-left text-[11px] text-zinc-500">Holiday period {prettyDate(b.period.start)} – {prettyDate(b.period.end)} · allowance from {b.from === "person" ? "their personal setting" : b.from === "role" ? `the ${b.roleName} role` : "the general policy"}</p>
                      </div>
                    )}
                    {clashes.length > 0 && (
                      <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                        <p className="flex items-center gap-1.5 font-medium"><Icon name="alert" className="size-4" />On {clashes.length} published shift{clashes.length > 1 ? "s" : ""}</p>
                        <ul className="mt-1 list-disc pl-5 text-amber-900">{clashes.map(({ r, s }) => <li key={r.id + s.id}>{shiftLabel(store, r, s.id)}</li>)}</ul>
                        <p className="mt-1 text-xs text-amber-800">If you approve, unlock those weeks and reassign. Changes within 24 hours go to staff as suggestions.</p>
                      </div>
                    )}
                    {alsoOff.length > 0 && <p className="mt-3 text-xs text-zinc-600">Also off then: {alsoOff.map((o) => `${emps[o.employeeId]?.name ?? "someone"} (${o.status})`).join(", ")}</p>}
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <form action={decideHolidayAction.bind(null, storeId, h.id, false)}><button className="btn-secondary w-full">Decline</button></form>
                      <form action={decideHolidayAction.bind(null, storeId, h.id, true)}><button className="btn-primary w-full"><Icon name="check" className="size-4" />Approve</button></form>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {pending.declined.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Declined outside-availability shifts · {pending.declined.length}</h2>
              <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                {pending.declined.map(({ rota, x }) => (
                  <div key={rota.id + x.shiftId + x.employeeId} className="flex flex-wrap items-center gap-3 p-4">
                    <Avatar name={emps[x.employeeId]?.name ?? "?"} size="sm" />
                    <p className="min-w-0 flex-1 text-sm"><b className="font-medium">{emps[x.employeeId]?.name}</b> can&apos;t do {shiftLabel(store, rota, x.shiftId)}. Reassign it.</p>
                    <Link href={`/s/${storeId}/rota?week=${rota.weekStart}`} className="btn-secondary btn-sm">Open rota</Link>
                  </div>
                ))}
              </div>
            </section>
          )}

          {waitingOnStaff.length > 0 && (
            <section>
              <h2 className="eyebrow mb-3">Waiting for staff to agree · {waitingOnStaff.length}</h2>
              <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                {waitingOnStaff.map(({ r, x }) => (
                  <div key={r.id + x.shiftId + x.employeeId} className="flex items-center gap-3 p-4 text-sm">
                    <Icon name="clock" className="size-4 text-amber-600" />
                    <span><b className="font-medium">{emps[x.employeeId]?.name}</b> · {shiftLabel(store, r, x.shiftId)} (outside their availability)</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="card overflow-x-auto p-0 sm:p-0">
            <div className="px-4 pt-4 sm:px-6"><h2 className="font-semibold">Swaps</h2></div>
            <table className="mt-2 w-full min-w-[640px]">
              <thead><tr><th className="th">Shift</th><th className="th">From</th><th className="th">To</th><th className="th">Status</th><th className="th">Posted</th></tr></thead>
              <tbody>
                {swaps.map((s) => (
                  <tr key={s.id}>
                    <td className="td">{rotaById[s.rotaId] ? shiftLabel(store, rotaById[s.rotaId], s.shiftId) : s.shiftId}</td>
                    <td className="td">{emps[s.fromEmployeeId]?.name ?? "—"}</td>
                    <td className="td">{s.toEmployeeId ? emps[s.toEmployeeId]?.name : "—"}</td>
                    <td className="td"><Badge tone={SWAP_TONE[s.status]}>{SWAP_LABEL[s.status]}</Badge></td>
                    <td className="td text-zinc-500">{prettyDate(s.createdAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!swaps.length && <p className="p-4 text-sm text-zinc-500">No swaps yet.</p>}
          </section>
          <section className="card overflow-x-auto p-0 sm:p-0">
            <div className="px-4 pt-4 sm:px-6"><h2 className="font-semibold">Availability requests</h2></div>
            <table className="mt-2 w-full min-w-[640px]">
              <thead><tr><th className="th">Person</th><th className="th">Change</th><th className="th">Status</th><th className="th">Decided by</th></tr></thead>
              <tbody>
                {allAvail.filter((a) => a.status !== "pending" && a.requestedBy !== a.decidedBy).map((a) => (
                  <tr key={a.id}>
                    <td className="td">{emps[a.employeeId]?.name}</td>
                    <td className="td">{a.kind === "temporary" ? `Temporary · ${a.note} · ${tempRange(a)}` : "Usual pattern"}</td>
                    <td className="td"><Badge tone={a.status === "approved" ? "green" : "red"}>{a.status}</Badge></td>
                    <td className="td text-zinc-500">{a.decidedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}
