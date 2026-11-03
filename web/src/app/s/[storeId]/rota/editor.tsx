"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { Avatar, IssueList } from "@/components/ui";
import { colorOf } from "@/lib/colors";
import { DAY_LABEL, DAY_NAME, type Assignment, type Day, type Issue, type RotaException, type ShiftInstance } from "@/lib/types";
import { approveRota, checkDraft, generateRota, saveDraft } from "./actions";
import { deleteTemplate, loadAssignments, saveTemplate } from "./template-actions";

interface Emp { id: string; name: string; visitingFrom: string | null; roleIds: string[]; role: string; contractedHours: number; maxHoursPerWeek: number; isUnder18: boolean; isStudent: boolean; hasAvailability: boolean }
interface Props {
  storeId: string;
  week: string;
  days: { day: Day; date: string }[];
  templates: { id: string; name: string; start: string; end: string; color: string }[];
  shifts: ShiftInstance[];
  employees: Emp[];
  availableFor: Record<string, string[]>;
  initial: Assignment[];
  initialExceptions: RotaException[];
  status: "draft" | "approved" | null;
  hasRota: boolean;
  /** Role id -> name/colour, for showing required service roles on each shift. */
  roleInfo: Record<string, { name: string; color: string }>;
  /** Published weeks: shifts starting within 24h ("locked") or already started ("past"). */
  lockedShifts: Record<string, "locked" | "past">;
  /** Approved holiday dates this week, per person. */
  holidayDays: Record<string, string[]>;
  /** Permissions and feature switches. */
  canEdit: boolean;
  canPublish: boolean;
  outOfHours: boolean;
  dayView: boolean;
  /** Only for people allowed to see pay (labour cost feature on): hourly rate per person, weekly budget. Never sent to the AI. */
  labour?: { rates: Record<string, number | null>; budget: number | null } | null;
  /** Saved rota templates and the previous week's start, for "copy" tools. */
  templates2?: { id: string; name: string }[];
  prevWeek?: string;
}
type Ex = Pick<RotaException, "shiftId" | "employeeId" | "status">;
type View = "week" | "day";

const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const short = (name: string) => {
  const [f, l] = name.split(" ");
  return l ? `${f} ${l[0]}` : f;
};
const fmtH = (m: number) => `${+(m / 60).toFixed(1)}h`;
const hourLabel = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:00`;

export function RotaEditor(p: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>(p.initial);
  const [exceptions, setExceptions] = useState<Ex[]>(p.initialExceptions);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [checking, setChecking] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err" | "busy"; text: string; reasons?: string[] } | null>(null);
  const [selected, setSelected] = useState<{ shiftId: string | null; employeeId: string } | null>(null);
  const [override, setOverride] = useState(false);
  const [view, setView] = useState<View>("week");
  const [day, setDay] = useState<Day>(p.days[0]?.day ?? "mon");
  const [busy, start] = useTransition();
  const locked = p.status === "approved" || !p.canEdit;
  const reqId = useRef(0);

  const shiftById = useMemo(() => Object.fromEntries(p.shifts.map((s) => [s.id, s])), [p.shifts]);
  const empById = useMemo(() => Object.fromEntries(p.employees.map((e) => [e.id, e])), [p.employees]);
  const exKey = (x: { shiftId: string; employeeId: string }) => `${x.shiftId}|${x.employeeId}`;
  const exMap = useMemo(() => new Map(exceptions.map((x) => [exKey(x), x.status])), [exceptions]);
  const keys = useCallback((ex: Ex[]) => ex.map(({ shiftId, employeeId }) => ({ shiftId, employeeId })), []);

  const runCheck = useCallback(
    async (a: Assignment[], ex: Ex[]) => {
      if (!a.length) return setIssues([]);
      const id = ++reqId.current;
      setChecking(true);
      const r = await checkDraft(p.storeId, p.week, a, keys(ex));
      if (id !== reqId.current) return;
      setChecking(false);
      setIssues(r.issues);
      if (r.error) setMessage({ tone: "err", text: r.error });
    },
    [p.storeId, p.week, keys],
  );
  useEffect(() => {
    const t = setTimeout(() => runCheck(assignments, exceptions), dirty ? 350 : 0);
    return () => clearTimeout(t);
  }, [assignments, exceptions, dirty, runCheck]);

  /** Move or add someone. Putting a person on a shift outside their availability is allowed
   *  by hand only, and becomes an ask they must agree to. */
  function move(employeeId: string, from: string | null, to: string | null) {
    if (locked || from === to) return;
    let next = assignments;
    let ex = exceptions;
    if (from) {
      next = next.filter((a) => !(a.shiftId === from && a.employeeId === employeeId));
      ex = ex.filter((x) => !(x.shiftId === from && x.employeeId === employeeId));
    }
    if (to && !(p.availableFor[to] ?? []).includes(employeeId) && !p.outOfHours) {
      setMessage({ tone: "err", text: `${empById[employeeId]?.name ?? "They"} isn't available for that shift, and asking staff to work outside their availability is switched off.` });
      setSelected(null);
      return;
    }
    if (to && !next.some((a) => a.shiftId === to && a.employeeId === employeeId)) {
      next = [...next, { shiftId: to, employeeId }];
      if (!(p.availableFor[to] ?? []).includes(employeeId)) ex = [...ex, { shiftId: to, employeeId, status: "pending" }];
    }
    setAssignments(next);
    setExceptions(ex);
    setDirty(true);
    setMessage(null);
    setSelected(null);
  }

  // ---------------------------------------------------------------- derived
  const byShift = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of assignments) (m[a.shiftId] ??= []).push(a.employeeId);
    return m;
  }, [assignments]);
  const minutesBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of assignments) m[a.employeeId] = (m[a.employeeId] ?? 0) + (shiftById[a.shiftId]?.minutes ?? 0);
    return m;
  }, [assignments, shiftById]);
  const cellIssues = (shiftId: string) => issues.filter((i) => i.shiftId === shiftId && !i.employeeIds?.length && i.severity !== "info");
  const personIssue = (shiftId: string, empId: string) => issues.find((i) => i.shiftId === shiftId && i.employeeIds?.includes(empId) && i.severity !== "info");
  const errors = issues.filter((i) => i.severity === "error");
  // Legal limits and unmet contracts can't be overridden.
  const legal = errors.filter((i) => i.legal || i.blocking).length;
  const dayHasProblem = (d: Day) => issues.some((i) => i.severity === "error" && i.shiftId?.endsWith(`:${d}`));

  // ---------------------------------------------------------------- actions
  const generate = () =>
    start(async () => {
      setMessage({ tone: "busy", text: "Building the fairest rota for this week…" });
      const r = await generateRota(p.storeId, p.week);
      if (!r.ok) return setMessage({ tone: "err", text: r.error, reasons: r.reasons });
      setAssignments(r.assignments);
      setExceptions([]);
      setIssues(r.issues);
      setDirty(false);
      // The rule pill shows the result; only say something if people were left out.
      setMessage(r.missingAvailability.length ? { tone: "ok", text: `Not scheduled (no availability yet): ${r.missingAvailability.join(", ")}.` } : null);
    });
  const save = () =>
    start(async () => {
      const r = await saveDraft(p.storeId, p.week, assignments, keys(exceptions));
      if (r.ok) setDirty(false);
      setMessage(r.ok ? { tone: "ok", text: "Draft saved." } : { tone: "err", text: r.error ?? "Couldn't save." });
    });
  const approve = () =>
    start(async () => {
      const r = await approveRota(p.storeId, p.week, assignments, keys(exceptions), override);
      if (!r.ok) {
        if ("issues" in r && r.issues) setIssues(r.issues);
        return setMessage({ tone: "err", text: r.error ?? "Couldn't approve." });
      }
      setDirty(false);
    });

  // ---------------------------------------------------------------- reuse & bulk edits
  const [tools, setTools] = useState(false);
  const replaceWith = (incoming: Assignment[], label: string) => {
    // Keep shifts that are already locked (within 24h / started); only take what fits this week's
    // shifts, people and availability. Anything else is dropped and reported.
    const keep = assignments.filter((a) => p.lockedShifts[a.shiftId]);
    const fits = incoming.filter((a) => shiftById[a.shiftId] && empById[a.employeeId] && !p.lockedShifts[a.shiftId] && (p.availableFor[a.shiftId] ?? []).includes(a.employeeId));
    const seen = new Set<string>();
    const next = [...keep, ...fits].filter((a) => (seen.has(exKey(a)) ? false : (seen.add(exKey(a)), true)));
    setAssignments(next);
    setExceptions(exceptions.filter((x) => next.some((a) => exKey(a) === exKey(x)) && p.lockedShifts[x.shiftId]));
    setDirty(true);
    setTools(false);
    const dropped = incoming.length - fits.length;
    setMessage({ tone: "ok", text: `${label}: ${fits.length} shift${fits.length === 1 ? "" : "s"} filled.${dropped ? ` ${dropped} left out (no longer available, on holiday, left, or the shift changed).` : ""} Check it, then save.` });
  };
  const copyFrom = (source: { week: string } | { templateId: string }, label: string) =>
    start(async () => {
      const r = await loadAssignments(p.storeId, source);
      if (!r.ok || !r.assignments) return setMessage({ tone: "err", text: r.error ?? "Couldn't load it." });
      // Shift ids are "<template>:<day>", so the same pattern lands on the same weekday.
      replaceWith(r.assignments, label);
    });
  const clear = (dayOnly: Day | null) => {
    const next = assignments.filter((a) => p.lockedShifts[a.shiftId] || (dayOnly && shiftById[a.shiftId]?.day !== dayOnly));
    setAssignments(next);
    setExceptions(exceptions.filter((x) => next.some((a) => exKey(a) === exKey(x))));
    setDirty(true);
    setTools(false);
    setMessage({ tone: "ok", text: dayOnly ? `Cleared ${DAY_NAME[dayOnly]}.` : "Cleared the week (locked shifts kept)." });
  };
  const [tplName, setTplName] = useState("");
  const storeTemplate = () =>
    start(async () => {
      const r = await saveTemplate(p.storeId, tplName, assignments);
      setMessage(r.ok ? { tone: "ok", text: `Saved as "${tplName}".` } : { tone: "err", text: r.error ?? "Couldn't save." });
      if (r.ok) {
        setTplName("");
        setTools(false);
      }
    });

  // drag and drop (desktop) + tap-to-move (touch)
  const dragProps = (employeeId: string, from: string | null) =>
    locked
      ? {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.setData("text/plain", JSON.stringify({ employeeId, from }));
            e.dataTransfer.effectAllowed = "move";
          },
        };
  const dropProps = (to: string) =>
    locked
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => e.preventDefault(),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            try {
              const { employeeId, from } = JSON.parse(e.dataTransfer.getData("text/plain"));
              move(employeeId, from, to);
            } catch {
              /* not ours */
            }
          },
        };

  // ---------------------------------------------------------------- pieces
  const Person = ({ eid, sid, compact }: { eid: string; sid: string; compact?: boolean }) => {
    const e = empById[eid];
    const iss = personIssue(sid, eid);
    const ex = exMap.get(`${sid}|${eid}`);
    const isSel = selected?.employeeId === eid && selected.shiftId === sid;
    const tone =
      ex === "declined" || iss?.severity === "error"
        ? "ring-red-300 bg-red-50"
        : ex === "pending"
          ? "ring-amber-300 bg-amber-50"
          : iss
            ? "ring-amber-300 bg-amber-50"
            : "ring-zinc-200 bg-white";
    return (
      <div
        {...dragProps(eid, sid)}
        onClick={(ev) => {
          if (locked) return;
          ev.stopPropagation();
          setSelected(isSel ? null : { shiftId: sid, employeeId: eid });
        }}
        title={iss?.message ?? (ex === "pending" ? "Outside their availability: waiting for them to agree" : ex === "agreed" ? "Agreed to work outside their availability" : `${e?.name} · ${e?.role}`)}
        className={`group flex items-center gap-2 rounded-lg px-1.5 ring-1 select-none ${compact ? "py-1" : "py-1.5"} ${tone} ${isSel ? "outline-2 outline-offset-1 outline-brand-500" : ""} ${locked ? "" : "cursor-grab active:cursor-grabbing"}`}
      >
        <Avatar name={e?.name ?? "?"} size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium">{e ? short(e.name) : "Former staff"}</div>
          {!compact && <div className="truncate text-[11px] text-zinc-500">{e?.role}</div>}
        </div>
        {ex === "pending" && <Icon name="clock" className="size-3.5 shrink-0 text-amber-600" />}
        {ex === "agreed" && <Icon name="check" className="size-3.5 shrink-0 text-emerald-600" />}
        {!locked && (
          <button
            className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-400 opacity-100 hover:bg-zinc-100 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
            aria-label={`Remove ${e?.name}`}
            onClick={(ev) => {
              ev.stopPropagation();
              move(eid, sid, null);
            }}
          >
            <Icon name="x" className="size-3.5" />
          </button>
        )}
      </div>
    );
  };

  const AddPicker = ({ s }: { s: ShiftInstance }) => {
    const busyToday = new Set(assignments.filter((a) => shiftById[a.shiftId]?.day === s.day).map((a) => a.employeeId));
    const free = p.employees.filter((e) => !busyToday.has(e.id));
    if (!free.length || locked) return null;
    const avail = free.filter((e) => (p.availableFor[s.id] ?? []).includes(e.id));
    const other = p.outOfHours ? free.filter((e) => !(p.availableFor[s.id] ?? []).includes(e.id)) : [];
    return (
      <select
        className="no-print mt-1 h-8 w-full cursor-pointer rounded-lg border border-dashed border-zinc-300 bg-transparent px-2 text-xs text-zinc-500 hover:border-brand-500 hover:text-brand-700"
        value=""
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => e.target.value && move(e.target.value, null, s.id)}
        aria-label={`Add someone to ${DAY_NAME[s.day]} ${s.name}`}
      >
        <option value="">+ Add person</option>
        {avail.length > 0 && <optgroup label="Available">{avail.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.role}{e.visitingFrom ? ` (from ${e.visitingFrom})` : ""}</option>)}</optgroup>}
        {other.length > 0 && <optgroup label="Outside availability (they must agree)">{other.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.role}</option>)}</optgroup>}
      </select>
    );
  };

  /** Required service roles for a shift, e.g. "Back of House 1/2", in red when short. */
  const Requirements = ({ s }: { s: ShiftInstance }) => {
    if (!s.requirements.length) return null;
    const people = (byShift[s.id] ?? []).map((id) => empById[id]).filter(Boolean);
    return (
      <div className="mb-1.5 flex flex-wrap gap-1">
        {s.requirements.map((r) => {
          const have = people.filter((e) => e.roleIds.includes(r.roleId)).length;
          const ok = have >= r.min;
          return (
            <span key={r.roleId} title={`${p.roleInfo[r.roleId]?.name ?? "Role"}: ${have} of ${r.min} required`} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-red-100 text-red-700"}`}>
              {p.roleInfo[r.roleId]?.name ?? "Role"} {have}/{r.min}
            </span>
          );
        })}
      </div>
    );
  };

  const LockMark = ({ s }: { s: ShiftInstance }) => {
    const st = p.lockedShifts[s.id];
    if (!st) return null;
    return (
      <span
        className={`mr-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${st === "past" ? "bg-zinc-200 text-zinc-600" : "bg-sky-100 text-sky-800"}`}
        title={st === "past" ? "Already started: can't be changed" : "Starts within 24 hours: changes go to the staff affected as suggestions they can accept"}
      >
        <Icon name="lock" className="size-3" />
        {st === "past" ? "Started" : "<24h"}
      </span>
    );
  };

  const Staffing = ({ s }: { s: ShiftInstance }) => {
    const n = (byShift[s.id] ?? []).length;
    const short = n < s.minStaff;
    return (
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${short ? "bg-red-100 text-red-700" : n > s.maxStaff ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"}`}>
        {n}/{s.minStaff}
        {s.maxStaff > s.minStaff ? `–${s.maxStaff}` : ""}
      </span>
    );
  };

  const DayPills = () => (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      {p.days.map((d) => (
        <button
          key={d.day}
          onClick={() => setDay(d.day)}
          className={`relative flex min-w-14 flex-col items-center rounded-xl border px-3 py-2 transition ${day === d.day ? "border-brand-600 bg-brand-600 text-white shadow-[var(--shadow-float)]" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"}`}
        >
          <span className="text-[11px] font-medium uppercase opacity-80">{DAY_LABEL[d.day]}</span>
          <span className="text-lg leading-tight font-semibold">{Number(d.date.slice(8))}</span>
          {dayHasProblem(d.day) && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500 ring-2 ring-white" />}
        </button>
      ))}
    </div>
  );

  const ShiftCard = ({ s }: { s: ShiftInstance }) => {
    const c = colorOf(s.color);
    const people = byShift[s.id] ?? [];
    const ci = cellIssues(s.id);
    return (
      <div
        {...dropProps(s.id)}
        onClick={() => selected && move(selected.employeeId, selected.shiftId, s.id)}
        className={`card overflow-hidden p-0 sm:p-0 ${ci.some((i) => i.severity === "error") ? "ring-2 ring-red-300" : ""} ${selected ? "cursor-pointer" : ""}`}
      >
        <div className={`flex items-center justify-between border-l-4 px-4 py-3 ${c.border} ${c.soft}`}>
          <div>
            <div className="font-semibold">{s.name}</div>
            <div className="text-xs text-zinc-600">{s.start}–{s.end} · {fmtH(s.minutes)} paid{s.breakMinutes ? ` · ${s.breakMinutes}m break` : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <LockMark s={s} />
            {selected && selected.shiftId !== s.id && <span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white">Move here</span>}
            <Staffing s={s} />
          </div>
        </div>
        <div className="space-y-1.5 p-3">
          <Requirements s={s} />
          {people.map((eid) => <Person key={eid} eid={eid} sid={s.id} />)}
          {!people.length && <p className="px-1 text-sm text-zinc-400">Nobody yet</p>}
          <AddPicker s={s} />
          {ci.map((i) => <p key={i.message} className={`px-1 text-xs ${i.severity === "error" ? "text-red-600" : "text-amber-700"}`}>{i.message}</p>)}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- views
  const WeekGrid = () => (
    <div className="card hidden overflow-x-auto p-0 sm:p-0 md:block">
      <table className="w-full min-w-[920px] table-fixed border-collapse">
        <thead>
          <tr className="border-b border-zinc-100">
            <th className="th w-32">Shift</th>
            {p.days.map((d) => (
              <th key={d.day} className="th text-center">
                <span className="font-semibold text-zinc-700">{DAY_LABEL[d.day]}</span> <span className="text-zinc-400">{Number(d.date.slice(8))}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.templates.map((t) => {
            const c = colorOf(t.color);
            return (
              <tr key={t.id} className="border-b border-zinc-100 last:border-0">
                <td className={`border-l-4 px-4 py-3 align-top ${c.border}`}>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-zinc-500">{t.start}–{t.end}</div>
                </td>
                {p.days.map(({ day: d }) => {
                  const s = shiftById[`${t.id}:${d}`];
                  if (!s) return <td key={d} className="border-l border-zinc-100 bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(244_244_245)_6px,rgb(244_244_245)_7px)]" />;
                  const ci = cellIssues(s.id);
                  const bad = ci.some((i) => i.severity === "error");
                  return (
                    <td
                      key={d}
                      {...dropProps(s.id)}
                      onClick={() => selected && move(selected.employeeId, selected.shiftId, s.id)}
                      title={ci.map((i) => i.message).join("\n")}
                      className={`border-l border-zinc-100 p-2 align-top transition ${bad ? "bg-red-50/70" : c.soft} ${selected ? "cursor-pointer hover:bg-brand-50" : ""}`}
                    >
                      <div className="mb-1.5 flex justify-end"><LockMark s={s} /><Staffing s={s} /></div>
                      <Requirements s={s} />
                      <div className="space-y-1">
                        {(byShift[s.id] ?? []).map((eid) => <Person key={eid} eid={eid} sid={s.id} compact />)}
                      </div>
                      <AddPicker s={s} />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const WeekMobile = () => (
    <div className="md:hidden">
      <DayPills />
      <div className="space-y-3">{p.shifts.filter((s) => s.day === day).map((s) => <ShiftCard key={s.id} s={s} />)}</div>
    </div>
  );

  const Timeline = () => {
    const todays = p.shifts.filter((s) => s.day === day);
    if (!todays.length) return <p className="card text-sm text-zinc-500">The store is closed on {DAY_NAME[day]}.</p>;
    const axisStart = Math.floor(Math.min(...todays.map((s) => toMin(s.start))) / 60) * 60;
    const axisEnd = Math.ceil(Math.max(...todays.map((s) => toMin(s.start) + s.span)) / 60) * 60;
    const span = axisEnd - axisStart;
    const pct = (m: number) => `${((m - axisStart) / span) * 100}%`;
    const hours = Array.from({ length: span / 60 }, (_, i) => axisStart + i * 60);
    const rows = todays
      .flatMap((s) => (byShift[s.id] ?? []).map((eid) => ({ s, eid })))
      .sort((a, b) => toMin(a.s.start) - toMin(b.s.start) || (empById[a.eid]?.name ?? "").localeCompare(empById[b.eid]?.name ?? ""));
    const coverage = hours.map((h) => {
      const mid = h + 30;
      const on = todays.filter((s) => toMin(s.start) <= mid && toMin(s.start) + s.span > mid);
      return { h, have: on.reduce((n, s) => n + (byShift[s.id]?.length ?? 0), 0), need: on.reduce((n, s) => n + s.minStaff, 0) };
    });
    const maxHave = Math.max(1, ...coverage.map((c) => Math.max(c.have, c.need)));

    return (
      <div>
        <DayPills />
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          {p.templates.filter((t) => todays.some((s) => s.templateId === t.id)).map((t) => (
            <span key={t.id} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${colorOf(t.color).bar}`} />{t.name} {t.start}–{t.end}</span>
          ))}
        </div>
        <div className="card overflow-x-auto p-0 sm:p-0">
          <div className="min-w-[680px]">
            {/* hour ruler */}
            <div className="flex border-b border-zinc-100">
              <div className="w-36 shrink-0 px-4 py-2 text-xs font-medium text-zinc-500">{DAY_NAME[day]}</div>
              <div className="relative h-8 flex-1">
                {hours.map((h) => (
                  <span key={h} className="absolute top-2 -translate-x-1/2 text-[11px] text-zinc-400 tabular-nums" style={{ left: pct(h) }}>{hourLabel(h).slice(0, 2)}</span>
                ))}
              </div>
              <div className="w-3 shrink-0" />
            </div>
            {/* coverage */}
            <div className="flex border-b border-zinc-100 bg-zinc-50/60">
              <div className="w-36 shrink-0 px-4 py-2 text-xs font-medium text-zinc-600">On shift</div>
              <div className="relative flex h-16 flex-1 items-end gap-px pt-2">
                {coverage.map((c) => (
                  <div key={c.h} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5" title={`${hourLabel(c.h)}: ${c.have} on shift, ${c.need} needed`}>
                    <span className={`text-[10px] leading-none font-semibold tabular-nums ${c.have < c.need ? "text-red-600" : "text-zinc-600"}`}>{c.have}</span>
                    <div className={`w-full rounded-t ${c.have < c.need ? "bg-red-400" : "bg-brand-500/70"}`} style={{ height: `${Math.max(8, (c.have / maxHave) * 70)}%` }} />
                  </div>
                ))}
              </div>
              <div className="w-3 shrink-0" />
            </div>
            {/* people */}
            {rows.map(({ s, eid }) => {
              const e = empById[eid];
              const c = colorOf(s.color);
              const ex = exMap.get(`${s.id}|${eid}`);
              const iss = personIssue(s.id, eid);
              return (
                <div key={s.id + eid} className="flex items-center border-b border-zinc-50 last:border-0">
                  <div className="flex w-36 shrink-0 items-center gap-2 px-4 py-2">
                    <Avatar name={e?.name ?? "?"} size="sm" />
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[13px] font-medium">{e ? short(e.name) : "Former staff"}</div>
                      <div className="truncate text-[11px] text-zinc-500">{e?.role}</div>
                    </div>
                  </div>
                  <div className="relative h-11 flex-1">
                    {hours.map((h) => <span key={h} className="absolute inset-y-0 border-l border-zinc-100" style={{ left: pct(h) }} />)}
                    <div
                      title={iss?.message}
                      className={`absolute inset-y-2 flex items-center gap-1.5 overflow-hidden rounded-lg px-2.5 text-xs font-semibold text-white shadow-sm ${c.bar} ${ex === "pending" ? "opacity-70 outline-2 outline-amber-500 outline-dashed" : ""} ${iss?.severity === "error" || ex === "declined" ? "outline-2 outline-red-500" : ""}`}
                      style={{ left: pct(toMin(s.start)), width: `${(s.span / span) * 100}%` }}
                    >
                      <span className="truncate">{s.name} · {s.start}–{s.end}</span>
                      {ex === "pending" && <Icon name="clock" className="size-3.5 shrink-0" />}
                    </div>
                  </div>
                  <div className="w-3 shrink-0" />
                </div>
              );
            })}
            {!rows.length && <p className="px-4 py-6 text-sm text-zinc-500">Nobody is on shift yet.</p>}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- labour cost
  const labour = useMemo(() => {
    if (!p.labour) return null;
    let total = 0;
    const byDay: Partial<Record<Day, number>> = {};
    const missing = new Set<string>();
    for (const a of assignments) {
      const s = p.shifts.find((x) => x.id === a.shiftId);
      if (!s) continue;
      const rate = p.labour.rates[a.employeeId];
      if (rate == null) {
        missing.add(p.employees.find((e) => e.id === a.employeeId)?.name ?? "Someone");
        continue;
      }
      const c = (s.minutes / 60) * rate;
      total += c;
      byDay[s.day] = (byDay[s.day] ?? 0) + c;
    }
    return { total, byDay, missing: [...missing] };
  }, [assignments, p.labour, p.shifts, p.employees]);
  const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const LabourPanel = () => {
    if (!labour || !p.labour) return null;
    const budget = p.labour.budget;
    const pct = budget ? (labour.total / budget) * 100 : null;
    const peak = Math.max(1, ...Object.values(labour.byDay).map((v) => v ?? 0));
    return (
      <section className="card" id="labour">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Labour cost</h2>
          <span className="text-xl font-semibold tabular-nums">{gbp(labour.total)}</span>
        </div>
        {budget ? (
          <>
            <div className="mt-2 h-2 overflow-hidden rounded-sm bg-zinc-100">
              <div className={`h-full ${pct! > 100 ? "bg-red-500" : pct! > 92 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct!)}%` }} />
            </div>
            <p className={`mt-1 text-xs ${pct! > 100 ? "font-semibold text-red-600" : "text-zinc-500"}`}>{Math.round(pct!)}% of the {gbp(budget)} weekly budget{pct! > 100 ? ` · ${gbp(labour.total - budget)} over` : ""}</p>
          </>
        ) : <p className="mt-1 text-xs text-zinc-500">Set a weekly budget in Settings to track against it.</p>}
        <div className="mt-3 flex h-16 items-end gap-1">
          {p.days.map(({ day: dd }) => (
            <div key={dd} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-sm bg-brand-500/80" style={{ height: `${((labour.byDay[dd] ?? 0) / peak) * 44}px` }} title={gbp(labour.byDay[dd] ?? 0)} />
              <span className="text-[10px] text-zinc-500">{DAY_LABEL[dd]}</span>
            </div>
          ))}
        </div>
        {labour.missing.length > 0 && <p className="mt-2 text-xs text-amber-700">No pay rate for {labour.missing.join(", ")} (not counted).</p>}
        <p className="mt-2 text-[11px] text-zinc-400">Paid hours × hourly rate, before employer NI and pension.</p>
      </section>
    );
  };

  // ---------------------------------------------------------------- hours panel
  const HoursPanel = () => (
    <section className="card">
      <h2 className="text-base font-semibold">Hours this week</h2>
      <p className="mt-0.5 mb-3 text-xs text-zinc-500">
        <b className="font-medium text-zinc-700">Scheduled</b> against their <b className="font-medium text-zinc-700">contract</b> (hours promised). The bar ends at their <b className="font-medium text-zinc-700">max</b> (the most they can work).
      </p>
      <div className="mb-3 flex items-center gap-4 text-[11px] text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-brand-500" />Scheduled</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-zinc-800" />Contract</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-4 rounded-full bg-zinc-200" />Up to max</span>
      </div>
      <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3">
        {p.employees.map((e) => {
          const h = (minutesBy[e.id] ?? 0) / 60;
          const max = Math.max(e.maxHoursPerWeek, h, 1);
          const diff = h - e.contractedHours;
          const over = h > e.maxHoursPerWeek;
          const status = over
            ? { t: `${+(h - e.maxHoursPerWeek).toFixed(1)}h over max`, c: "text-red-600" }
            : diff < -0.01
              ? { t: `${+(-diff).toFixed(1)}h below contract`, c: "font-semibold text-red-600" }
              : diff <= 1
                ? { t: "Contract met", c: "text-emerald-600" }
                : { t: `${+diff.toFixed(1)}h extra`, c: "text-sky-700" };
          return (
            <li
              key={e.id}
              {...dragProps(e.id, null)}
              onClick={() => !locked && setSelected(selected?.employeeId === e.id && !selected.shiftId ? null : { shiftId: null, employeeId: e.id })}
              className={`rounded-lg p-1.5 ${locked ? "" : "cursor-grab hover:bg-zinc-50"} ${selected?.employeeId === e.id && !selected.shiftId ? "bg-brand-50" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {e.name}
                  {!e.hasAvailability && <span className="ml-1 text-xs text-red-600" title="No availability set">· no availability</span>}
                  {p.holidayDays[e.id] && <span className="ml-1 rounded bg-violet-100 px-1 text-[10px] font-semibold text-violet-800">Holiday ×{p.holidayDays[e.id].length}</span>}
                  {e.visitingFrom && <span className="ml-1 rounded bg-teal-100 px-1 text-[10px] font-semibold text-teal-800" title="Their contract is met at their home site; hours there count towards limits here">From {e.visitingFrom}</span>}
                </span>
                <span className="text-sm font-semibold tabular-nums">{+h.toFixed(1)}h</span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-zinc-200/70">
                <div className={`h-2 rounded-full ${over || h < e.contractedHours ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, (h / max) * 100)}%` }} />
                <span className="absolute -top-1 h-4 w-0.5 rounded bg-zinc-800" style={{ left: `${Math.min(100, (e.contractedHours / max) * 100)}%` }} title={`Contract ${e.contractedHours}h`} />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
                <span>Contract {e.contractedHours}h · Max {e.maxHoursPerWeek}h</span>
                <span className={`font-medium ${status.c}`}>{status.t}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );

  // ---------------------------------------------------------------- layout
  const pendingAsks = exceptions.filter((x) => x.status === "pending").length;
  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-zinc-100 p-1">
            {(
              [
                ["week", "Week", "grid"],
                ["day", "Day by hour", "bars"],
              ] as const
            ).filter(([v]) => v === "week" || p.dayView).map(([v, label, icon]) => (
              <button key={v} onClick={() => setView(v)} className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${view === v ? "bg-white shadow-[var(--shadow-card)]" : "text-zinc-600"}`}>
                <Icon name={icon} className="size-4" />
                {label}
              </button>
            ))}
          </div>
          {!locked && (
            <div className="relative">
              <button className="btn-secondary" onClick={() => setTools(!tools)} aria-expanded={tools}><Icon name="grid" className="size-4" />Templates</button>
              {tools && (
                <div className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
                  <div className="grid gap-1">
                    {p.prevWeek && <button className="btn-ghost justify-start" disabled={busy} onClick={() => copyFrom({ week: p.prevWeek! }, "Copied last week")}>Copy last week</button>}
                    {(p.templates2 ?? []).map((t) => (
                      <div key={t.id} className="flex items-center gap-1">
                        <button className="btn-ghost flex-1 justify-start" disabled={busy} onClick={() => copyFrom({ templateId: t.id }, `Template "${t.name}"`)}>Use template: {t.name}</button>
                        <button className="btn-ghost btn-sm text-zinc-400" aria-label={`Delete template ${t.name}`} onClick={() => start(async () => { await deleteTemplate(p.storeId, t.id); })}><Icon name="x" className="size-4" /></button>
                      </div>
                    ))}
                    <hr className="my-1 border-zinc-100" />
                    {view === "day" && <button className="btn-ghost justify-start text-red-700" onClick={() => clear(day)}>Clear {DAY_NAME[day]}</button>}
                    <button className="btn-ghost justify-start text-red-700" onClick={() => clear(null)}>Clear the week</button>
                    {assignments.length > 0 && (
                      <>
                        <hr className="my-1 border-zinc-100" />
                        <div className="flex gap-2">
                          <input value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={60} placeholder="Template name, e.g. Summer week" className="input flex-1" />
                          <button className="btn-primary" disabled={busy || !tplName.trim()} onClick={storeTemplate}>Save</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {assignments.length > 0 && (
            <a href="#rule-check" className={`flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ${errors.length ? "bg-red-50 text-red-700" : issues.some((i) => i.severity === "warning") ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
              <Icon name={errors.length ? "alert" : "shield"} className="size-4" />
              {checking ? "Checking…" : errors.length ? `${errors.length} problem${errors.length > 1 ? "s" : ""}` : issues.some((i) => i.severity === "warning") ? "Check warnings" : "All rules met"}
            </a>
          )}
          {!locked && (
            <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
              {(p.hasRota || assignments.length > 0) && (
                <button className="btn-secondary flex-1 sm:flex-none" onClick={generate} disabled={busy}>
                  <Icon name="wand" className="size-4" />Regenerate
                </button>
              )}
              {assignments.length > 0 && (
                <>
                  <button className="btn-secondary flex-1 sm:flex-none" onClick={save} disabled={busy || !dirty}>Save draft</button>
                  {p.canPublish && (
                    <button className="btn-primary flex-1 sm:flex-none" onClick={approve} disabled={busy || checking || legal > 0}>
                      <Icon name="lock" className="size-4" /> Approve &amp; publish
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {!locked && message && message.tone !== "err" && (
          <div className="no-print -mt-1 mb-4">
            <span className={`flex items-center gap-2 text-sm ${message.tone === "busy" ? "text-sky-800" : "text-zinc-600"}`} role="status">
              {message.tone === "busy" && <span className="size-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />}
              {message.text}
            </span>
          </div>
        )}
        {!locked && assignments.length > 0 && (legal > 0 || errors.length > 0 || dirty || pendingAsks > 0) && (
          <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {legal > 0 && <span className="flex items-center gap-1.5 font-medium text-red-700"><Icon name="shield" className="size-4" />{legal} legal or contract problem{legal > 1 ? "s" : ""} must be fixed before publishing</span>}
            {legal === 0 && errors.length > 0 && (
              <label className="flex items-center gap-2 text-zinc-700">
                <input type="checkbox" className="size-4 accent-brand-600" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Approve anyway with {errors.length} rule problem{errors.length > 1 ? "s" : ""}
              </label>
            )}
            {pendingAsks > 0 && <span className="flex items-center gap-1.5 text-amber-800"><Icon name="clock" className="size-4" />{pendingAsks} outside-availability ask{pendingAsks > 1 ? "s" : ""}: they&apos;ll be asked to agree when you publish</span>}
            {dirty && <span className="text-amber-700">Unsaved changes</span>}
            {Object.values(p.lockedShifts).includes("locked") && <span className="flex items-center gap-1.5 text-sky-800"><Icon name="lock" className="size-4" />Changes to shifts within 24 hours are sent to staff as suggestions</span>}
          </div>
        )}

        {message?.tone === "err" && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950" role="alert">
            <div className="flex items-center gap-2">{message.text}</div>
            {message.reasons && <ul className="mt-1.5 list-disc pl-5">{message.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          </div>
        )}
        {selected && (
          <div className="no-print sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-[var(--shadow-float)] md:top-20">
            Moving <b>{empById[selected.employeeId]?.name}</b>. Tap a shift to place them.
            {selected.shiftId && <button className="underline" onClick={() => move(selected.employeeId, selected.shiftId, null)}>Remove from shift</button>}
            <button className="ml-auto rounded-md bg-white/15 px-2 py-0.5" onClick={() => setSelected(null)}>Cancel</button>
          </div>
        )}

        {!assignments.length && !p.hasRota ? (
          <div className="card flex flex-col items-center py-12 text-center">
            <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon name="wand" /></span>
            <p className="font-semibold">No rota for this week yet</p>
            <p className="mt-1 max-w-sm text-sm text-zinc-600">Generate one from your staff, their availability and your rules. It takes a few seconds, and every legal rest rule is built in.</p>
            {!locked && <button className="btn-primary mt-5" onClick={generate} disabled={busy}><Icon name="wand" className="size-4" />Generate rota</button>}
          </div>
        ) : view === "week" ? (
          <>
            <WeekGrid />
            <WeekMobile />
            {!locked && <p className="no-print mt-3 text-xs text-zinc-500">Drag a person to another shift, or tap them then tap a shift. Choosing someone outside their availability sends them a request to agree.</p>}
          </>
        ) : (
          <Timeline />
        )}
      </div>

      <aside className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="card lg:sticky lg:top-24" id="rule-check">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Rule check</h2>
            {checking ? <span className="text-xs text-zinc-400">Checking…</span> : <span className="text-xs text-zinc-400">Live</span>}
          </div>
          <IssueList issues={issues.filter((i) => i.severity !== "info" || i.code === "exception_agreed")} empty={assignments.length ? "Every rule and legal limit is met." : "Nothing to check yet."} />
          <p className="mt-3 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">Always checked: everyone gets their contracted hours, 11h between shifts (12h under 18) including across weeks, a 24h break each week (48h under 18), legal unpaid breaks, no under-18 work 22:00–06:00 or over 8h a day, required service roles, and your rules.</p>
        </section>
        <div className="grid gap-4">
          {p.labour && <LabourPanel />}
          <HoursPanel />
        </div>
      </aside>
    </div>
  );
}
