import Link from "next/link";
import { Icon } from "@/components/icons";
import { Avatar, Badge, EmptyState, Notice, PageHeader } from "@/components/ui";
import { can, requireStore } from "@/lib/auth";
import { breakRemaining, breakTotal, hm, minutesBetween, onBreak, paidMinutes, statutoryBreak, wallNow } from "@/lib/clock";
import { storeStaff } from "@/lib/org";
import { hasFeature } from "@/lib/roles";
import { PAYROLL_FORMATS, weekTimesheet } from "@/lib/timesheets";
import { addDays, mondayOf, parseDate, prettyDate } from "@/lib/time";
import type { ShiftInstance, TimeEntry } from "@/lib/types";
import { startKiosk } from "../../../kiosk/[storeId]/actions";
import { approveEntries, markSickAction, rejectEntry, saveEntry } from "./actions";

const TONE: Record<TimeEntry["status"], "blue" | "amber" | "green" | "red"> = { open: "blue", submitted: "amber", approved: "green", rejected: "red" };
const LABEL: Record<TimeEntry["status"], string> = { open: "On shift", submitted: "To approve", approved: "Approved", rejected: "Rejected" };
const SHOW = { all: "Everyone", working: "Working now", onBreak: "On break", breaksLeft: "Breaks remaining", toApprove: "To approve", missing: "No clock-in" } as const;
type Show = keyof typeof SHOW;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Shift log: a month calendar; pick a day to see who's rostered, clocked in, on break or missing. */
export default async function ShiftLogPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ day?: string; month?: string; error?: string; edit?: string; show?: string; add?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const access = await requireStore(storeId, "timesheets.approve");
  const { store } = access;
  const wall = wallNow(store.timezone);
  const today = wall.slice(0, 10);
  const day = sp.day && DATE.test(sp.day) ? sp.day : today;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : day.slice(0, 7);
  const show: Show = sp.show && sp.show in SHOW ? (sp.show as Show) : "all";

  // The calendar grid: Monday on or before the 1st, to the Sunday on or after the last day.
  const first = `${month}-01`;
  const gridStart = mondayOf(parseDate(first));
  const firstDate = parseDate(first);
  const lastOfMonth = addDays(first, new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0).getDate() - 1);
  const weeks: string[] = [];
  for (let w = gridStart; w <= lastOfMonth; w = addDays(w, 7)) weeks.push(w);
  const gridWeeks = [...weeks];
  const dayWeek = mondayOf(parseDate(day));
  if (!weeks.includes(dayWeek)) weeks.push(dayWeek);

  const [weekRows, staff] = await Promise.all([Promise.all(weeks.map((w) => weekTimesheet(store, w))), storeStaff(store)]);
  const rows = weekRows.flat();
  const byId = Object.fromEntries(staff.map((e) => [e.id, e]));
  const name = (id: string) => byId[id]?.name ?? "Former staff";

  const owed = (t: TimeEntry, shifts: ShiftInstance[]) => {
    const shift = shifts.find((s) => s.id === t.shiftId) ?? shifts[0];
    const worked = minutesBetween(t.clockIn, t.clockOut ?? wall);
    return breakRemaining({ shiftBreak: shift?.breakMinutes ?? 0, shiftMinutes: Math.max(worked, t.clockOut ? 0 : shift?.span ?? 0), under18: !!byId[t.employeeId]?.isUnder18, taken: breakTotal(t.breaks, wall) });
  };
  const shortBreak = (t: TimeEntry) => !!t.clockOut && breakTotal(t.breaks) < statutoryBreak(minutesBetween(t.clockIn, t.clockOut), !!byId[t.employeeId]?.isUnder18);
  type Row = (typeof rows)[number];
  const missing = (r: Row) => r.entries.length === 0 && r.scheduled.length > 0 && (r.date < today || (r.date === today && r.scheduled.some((s) => s.start < wall.slice(11, 16))));
  const matches = (r: Row, f: Show) => {
    switch (f) {
      case "working": return r.entries.some((t) => !t.clockOut && !onBreak(t));
      case "onBreak": return r.entries.some((t) => onBreak(t));
      case "breaksLeft": return r.entries.some((t) => !t.clockOut && owed(t, r.scheduled) > 0);
      case "toApprove": return r.entries.some((t) => t.status === "submitted");
      case "missing": return missing(r);
      default: return true;
    }
  };
  const rowsOn = (date: string) => rows.filter((r) => r.date === date);
  const dayRows = rowsOn(day).sort((a, b) => (a.scheduled[0]?.start ?? "99").localeCompare(b.scheduled[0]?.start ?? "99") || name(a.employeeId).localeCompare(name(b.employeeId)));
  const shown = dayRows.filter((r) => matches(r, show));
  const count = (f: Show) => dayRows.filter((r) => matches(r, f)).length;
  const monthToApprove = rows.filter((r) => r.date.startsWith(month)).flatMap((r) => r.entries.filter((t) => t.status === "submitted").map((t) => t.id));
  const dayToApprove = dayRows.flatMap((r) => r.entries.filter((t) => t.status === "submitted").map((t) => t.id));
  const clockOn = hasFeature(store.features, "clockIn");
  const withPay = can(access, "pay.view");
  const editing = dayRows.flatMap((r) => r.entries).find((t) => t.id === sp.edit);
  const link = (patch: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ day, month, ...(show !== "all" ? { show } : {}), ...patch }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const monthShift = (n: number) => {
    const m = new Date(firstDate.getFullYear(), firstDate.getMonth() + n, 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  };
  const monthLabel = firstDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const rostered = dayRows.filter((r) => r.scheduled.length).length;
  const paidDay = dayRows.flatMap((r) => r.entries).filter((t) => t.status !== "rejected").reduce((n, t) => n + paidMinutes(t), 0);

  return (
    <>
      <PageHeader
        title="Shift log"
        sub={clockOn ? "Pick a day to see who's rostered, who's in, who's on a break and who hasn't clocked in." : "Clock-in is switched off, so payroll uses published shifts. You can still add hours by hand."}
        actions={
          <>
            {clockOn && (
              <form action={startKiosk.bind(null, storeId)}>
                <button className="btn-secondary" title="Turns this device into the clock-in screen and signs you out on it"><Icon name="clock" className="size-4" />Start clock-in screen</button>
              </form>
            )}
            {monthToApprove.length > 0 && <form action={approveEntries.bind(null, storeId, monthToApprove)}><button className="btn-primary"><Icon name="check" className="size-4" />Approve {monthToApprove.length} this month</button></form>}
          </>
        }
      />
      {sp.error && <Notice tone="red">{sp.error}</Notice>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        {/* ------------------------------------------------ calendar */}
        <section className="card p-3 sm:p-4 lg:sticky lg:top-32" aria-label="Calendar">
          <div className="mb-3 flex items-center justify-between">
            <Link href={`?month=${monthShift(-1)}&day=${day}`} className="btn-ghost btn-sm px-2" aria-label="Previous month"><Icon name="left" className="size-5" /></Link>
            <div className="text-center">
              <h2 className="font-semibold">{monthLabel}</h2>
              {day !== today || month !== today.slice(0, 7) ? <Link href={`?day=${today}`} className="text-xs font-medium text-brand-700 hover:underline">Back to today</Link> : <span className="text-xs text-zinc-400">Today</span>}
            </div>
            <Link href={`?month=${monthShift(1)}&day=${day}`} className="btn-ghost btn-sm px-2" aria-label="Next month"><Icon name="right" className="size-5" /></Link>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-zinc-400">
            {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {gridWeeks.flatMap((w) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(w, i))).map((date) => {
              const rs = rowsOn(date);
              const inMonth = date.startsWith(month);
              const people = rs.filter((r) => r.scheduled.length || r.entries.length).length;
              const miss = rs.filter(missing).length;
              const approve = rs.filter((r) => matches(r, "toApprove")).length;
              const live = date === today ? rs.filter((r) => matches(r, "working") || matches(r, "onBreak")).length : 0;
              const selected = date === day;
              return (
                <Link
                  key={date}
                  href={`?month=${month}&day=${date}${show !== "all" ? `&show=${show}` : ""}`}
                  aria-current={selected ? "date" : undefined}
                  aria-label={`${prettyDate(date, { weekday: "long", day: "numeric", month: "long" })}: ${people} staff${miss ? `, ${miss} not clocked in` : ""}${approve ? `, ${approve} to approve` : ""}`}
                  className={`relative flex aspect-square flex-col items-center rounded-lg p-1 pt-1.5 text-sm transition ${
                    selected ? "bg-brand-600 text-white shadow-md shadow-brand-600/30" : inMonth ? "hover:bg-brand-50" : "text-zinc-300 hover:bg-zinc-50"
                  } ${date === today && !selected ? "ring-2 ring-brand-500 ring-inset" : ""}`}
                >
                  <span className="font-semibold tabular-nums">{Number(date.slice(8))}</span>
                  {people > 0 && <span className={`text-[10px] leading-tight ${selected ? "text-white/80" : inMonth ? "text-zinc-500" : ""}`}>{people} staff</span>}
                  <span className="mt-auto flex gap-0.5 pb-0.5">
                    {live > 0 && <span className={`size-1.5 rounded-sm ${selected ? "bg-white" : "bg-brand-500"}`} />}
                    {approve > 0 && <span className={`size-1.5 rounded-sm ${selected ? "bg-amber-200" : "bg-amber-500"}`} />}
                    {miss > 0 && <span className={`size-1.5 rounded-sm ${selected ? "bg-rose-200" : "bg-rose-500"}`} />}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-sm bg-brand-500" />In now</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-sm bg-amber-500" />To approve</span>
            <span className="flex items-center gap-1"><span className="size-1.5 rounded-sm bg-rose-500" />No clock-in</span>
          </div>
        </section>

        {/* ------------------------------------------------ the chosen day */}
        <section className="min-w-0" aria-label="Staff on the selected day">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">{day === today ? "Today" : day < today ? "Past day" : "Upcoming day"}</p>
              <h2 className="text-xl font-semibold tracking-tight">{prettyDate(day, { weekday: "long", day: "numeric", month: "long" })}</h2>
              <p className="text-sm text-zinc-500">{rostered} rostered · {hm(paidDay)} paid time clocked</p>
            </div>
            <div className="flex gap-2">
              {dayToApprove.length > 0 && <form action={approveEntries.bind(null, storeId, dayToApprove)}><button className="btn-secondary btn-sm"><Icon name="check" className="size-4" />Approve day ({dayToApprove.length})</button></form>}
              <Link href={`${link({ add: "1", edit: undefined })}#edit`} className="btn-secondary btn-sm"><Icon name="plus" className="size-4" />Add hours</Link>
            </div>
          </div>
          <nav className="no-scrollbar mb-3 flex gap-2 overflow-x-auto" aria-label="Filter">
            {(Object.keys(SHOW) as Show[]).map((k) => (
              <Link key={k} href={`?${new URLSearchParams({ day, month, ...(k !== "all" ? { show: k } : {}) }).toString()}`} aria-current={show === k ? "page" : undefined} className={`flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ${show === k ? "border-brand-600 bg-brand-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"}`}>
                {SHOW[k]}
                <span className={`rounded-md px-1.5 text-xs ${show === k ? "bg-white/20" : "bg-zinc-100"}`}>{k === "all" ? dayRows.length : count(k)}</span>
              </Link>
            ))}
          </nav>

          <div className="space-y-2">
            {shown.map((r) => {
              const miss = missing(r);
              return (
                <div key={r.employeeId} className={`card p-4 sm:p-4 ${miss ? "border-rose-200 bg-rose-50/40" : ""}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={name(r.employeeId)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{name(r.employeeId)}</p>
                      <p className="text-sm text-zinc-500">{r.scheduled.length ? `Rostered ${r.scheduled.map((s) => `${s.name} ${s.start}–${s.end}`).join(", ")}` : "Not rostered"}</p>
                    </div>
                    {miss && <Badge tone="red" icon="alert">No clock-in</Badge>}
                    {!r.entries.length && !miss && r.scheduled.length > 0 && <Badge tone="blue">Not in yet</Badge>}
                    {!r.entries.length && r.rotaId && r.date >= today && r.scheduled[0] && (
                      <form action={markSickAction.bind(null, storeId, r.employeeId, r.rotaId, r.scheduled[0].id, day)}>
                        <button className="btn-ghost btn-sm text-rose-700" title="Takes them off the rota and offers the shift to others">Mark off sick</button>
                      </form>
                    )}
                  </div>
                  {r.entries.map((t) => {
                    const left = !t.clockOut ? owed(t, r.scheduled) : 0;
                    const breaks = t.breaks ?? [];
                    return (
                      <div key={t.id} className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm">
                        <span className="flex items-center gap-1.5 tabular-nums"><Icon name="clock" className="size-4 text-brand-600" />{t.clockIn.slice(11, 16)}–{t.clockOut ? t.clockOut.slice(11, 16) : <span className="font-medium text-brand-700">now</span>}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Icon name="coffee" className="size-4 text-amber-600" />
                          {breaks.length ? breaks.map((b, j) => <span key={j} className="tabular-nums">{j > 0 && ", "}{b.start.slice(11, 16)}–{b.end ? `${b.end.slice(11, 16)} (${minutesBetween(b.start, b.end)}m)` : <span className="font-medium text-amber-700">on break</span>}</span>) : <span className="text-zinc-400">No break</span>}
                        </span>
                        {t.clockOut && <span className="font-semibold tabular-nums">{hm(paidMinutes(t))} paid</span>}
                        {left > 0 && <Badge tone="amber">{left} min break left</Badge>}
                        {shortBreak(t) && <Badge tone="red" icon="alert">Short of legal break</Badge>}
                        <span className="ml-auto flex items-center gap-1">
                          <Badge tone={onBreak(t) ? "amber" : TONE[t.status]}>{onBreak(t) ? "On break" : t.source === "manual" ? "Added by manager" : LABEL[t.status]}</Badge>
                          {t.status === "submitted" && <form action={approveEntries.bind(null, storeId, [t.id])}><button className="btn-ghost btn-sm text-emerald-700">Approve</button></form>}
                          {t.status !== "open" && t.status !== "rejected" && <form action={rejectEntry.bind(null, storeId, t.id)}><button className="btn-ghost btn-sm text-zinc-500">Reject</button></form>}
                          <Link href={`${link({ edit: t.id, add: undefined })}#edit`} className="btn-ghost btn-sm">Edit</Link>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {!shown.length && (
              <div className="card">
                <EmptyState title={show === "all" ? "No one on this day" : `No one: ${SHOW[show].toLowerCase()}`} icon="calendar">{show === "all" ? "Nobody was rostered or clocked in." : "Try another filter."}</EmptyState>
              </div>
            )}
          </div>

          {(editing || sp.add) && (
            <section className="card mt-6 scroll-mt-32" id="edit">
              <h2 className="mb-3 font-semibold">{editing ? `Edit ${name(editing.employeeId)}'s shift` : `Add hours for ${prettyDate(day, { weekday: "short", day: "numeric", month: "short" })}`}</h2>
              <form action={saveEntry.bind(null, storeId)} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {editing ? <input type="hidden" name="id" value={editing.id} /> : (
                  <div className="col-span-2 sm:col-span-4">
                    <label className="label">Person</label>
                    <select name="employeeId" className="input" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {staff.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="col-span-2"><label className="label">Date</label><input name="date" type="date" className="input" required defaultValue={editing?.clockIn.slice(0, 10) ?? day} /></div>
                <div><label className="label">Clock in</label><input name="in" type="time" className="input" required defaultValue={editing?.clockIn.slice(11, 16)} /></div>
                <div><label className="label">Clock out</label><input name="out" type="time" className="input" defaultValue={editing?.clockOut?.slice(11, 16)} /></div>
                {[0, 1, 2].map((i) => {
                  const b = editing?.breaks?.[i];
                  return (
                    <div key={i} className="col-span-2 grid grid-cols-2 gap-3 sm:col-span-4 sm:grid-cols-4">
                      <div><label className="label">Break {i + 1} start</label><input name={`b${i}s`} type="time" className="input" defaultValue={b?.start.slice(11, 16)} /></div>
                      <div><label className="label">Break {i + 1} end</label><input name={`b${i}e`} type="time" className="input" defaultValue={b?.end?.slice(11, 16)} /></div>
                    </div>
                  );
                })}
                <div className="col-span-2 sm:col-span-4"><label className="label">Note</label><input name="note" className="input" maxLength={200} defaultValue={editing?.note} placeholder="e.g. forgot to clock out" /></div>
                <div className="col-span-2 flex gap-2 sm:col-span-4">
                  <button className="btn-primary">{editing ? "Save changes" : "Add hours"}</button>
                  <Link href={link({ edit: undefined, add: undefined })} className="btn-ghost">Cancel</Link>
                </div>
              </form>
              <p className="mt-2 text-xs text-zinc-500">Leave clock out empty to keep someone on shift. Edits are saved as approved and kept in the audit log with the before and after times.</p>
            </section>
          )}
        </section>
      </div>

      <section className="card mt-8">
        <h2 className="mb-1 font-semibold">Payroll export</h2>
        <p className="mb-3 text-sm text-zinc-600">Hours per person for the period from {clockOn ? "approved shifts in this log" : "published shifts"} (breaks deducted), plus paid holiday hours and sick days.{withPay ? " Includes pay rates." : " Pay rates are left out (you don't have the pay permission)."}</p>
        <form action={`/api/payroll/${storeId}`} method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <div><label className="label">From</label><input name="from" type="date" className="input" defaultValue={first} required /></div>
          <div><label className="label">To</label><input name="to" type="date" className="input" defaultValue={lastOfMonth} required /></div>
          <div>
            <label className="label">Format</label>
            <select name="format" className="input" defaultValue="generic">
              {Object.entries(PAYROLL_FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <button className="btn-secondary">Download CSV</button>
        </form>
        <p className="mt-2 text-xs text-zinc-500">Payroll codes differ between setups: check the first export against your payroll before relying on it.</p>
      </section>
    </>
  );
}
