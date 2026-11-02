import type { Tables } from "./db";
import { liveAssignments } from "./live";
import { addDays, dayDate, isoDate, mondayOf, shiftsForStore } from "./time";
import { breakTotal } from "./clock";
import type { BreakPeriod, Store, TimeEntry } from "./types";

type Data = { [N in keyof Tables]: Tables[N][] };

/**
 * Demo data for pay, compliance and time & attendance at the Leeds site: role pay rates,
 * a weekly budget, age bands, right-to-work and qualification records (with a few problems
 * to find), last week's approved timesheets, this week's clock-ins waiting for approval,
 * and one sick day.
 */
export function seedOps(data: Data, store: Store, managerEmail: string) {
  const today = isoDate(new Date());
  const week = mondayOf();
  store.weeklyLabourBudget = 4200;
  store.phone = "0113 496 0000"; // Ofcom drama number, not a real line

  const role = (name: string) => data.roles.find((r) => r.storeId === store.id && r.name === name);
  const rates: Record<string, number> = { "Shift Lead": 13.75, "Back of House": 12.95, "Front of House": 12.75 };
  for (const [name, rate] of Object.entries(rates)) {
    const r = role(name);
    if (r) r.hourlyRate = rate;
  }
  const emp = (key: string) => data.employees.find((e) => e.id === `emp-${key}`)!;
  for (const e of data.employees.filter((x) => x.storeId === store.id)) {
    e.ageBand = e.isUnder18 ? "16-17" : "21+";
    e.rightToWorkCheckedAt = e.startDate;
    e.notify = { email: true, sms: false, push: true };
  }
  // Problems for the compliance panel to find:
  emp("grace").ageBand = "18-20";
  emp("dan").hourlyRate = 11.5; // below the 21+ National Living Wage
  emp("olivia").rightToWorkCheckedAt = null; // never recorded
  emp("harry").rightToWorkExpires = addDays(today, 21); // student visa ending soon
  emp("alex").payrollId = "TW001";
  emp("priya").payrollId = "TW002";
  const plh = role("Personal Licence Holder");
  const fh = role("Food Hygiene L2");
  const fa = role("First Aider");
  const give = (key: string, roleId: string | undefined, expiry: string) => {
    if (!roleId) return;
    const e = emp(key);
    e.roleIds = [...e.roleIds, roleId];
    e.qualificationExpiry = { ...(e.qualificationExpiry ?? {}), [roleId]: expiry };
  };
  give("alex", plh?.id, addDays(today, 365 * 5));
  give("priya", plh?.id, addDays(today, 20)); // expiring soon
  give("ben", fh?.id, addDays(today, 400));
  give("chloe", fh?.id, addDays(today, -10)); // expired
  give("dan", fh?.id, addDays(today, 200));
  give("jordan", fa?.id, addDays(today, 500));

  // Shift log: last week approved (small real-world variance), this week's finished shifts submitted,
  // and anyone whose shift is under way right now clocked in (one of them on a break).
  const shifts = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  const now = Date.now();
  const jitter = (seed: string, spread: number) => {
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return (h % (spread * 2 + 1)) - spread;
  };
  const stamp = (date: string, hm: string, plusMin: number) => {
    const t = new Date(`${date}T${hm}:00`);
    t.setMinutes(t.getMinutes() + plusMin);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:00`;
  };
  const sick = { key: "mia", week: addDays(week, -7) };
  let someoneOnBreak = false;
  for (const ws of [addDays(week, -7), week]) {
    const rota = data.rotas.find((r) => r.storeId === store.id && r.weekStart === ws);
    if (!rota) continue;
    for (const a of liveAssignments(rota) ?? []) {
      const s = shifts[a.shiftId];
      if (!s) continue;
      const date = dayDate(ws, s.day);
      const startMs = new Date(`${date}T${s.start}:00`).getTime();
      if (startMs > now) continue; // not started yet
      const ended = startMs + s.span * 60_000 <= now;
      // One sick day last week: no clock-in, an absence instead.
      if (ws === sick.week && a.employeeId === `emp-${sick.key}` && s.day === "tue") {
        data.absences.push({ id: `abs-${date}`, storeId: store.id, employeeId: a.employeeId, date, rotaId: rota.id, shiftId: s.id, reason: "sick", note: "", createdAt: new Date().toISOString() });
        continue;
      }
      const k = `${a.employeeId}${a.shiftId}${ws}`;
      const clockIn = stamp(date, s.start, jitter(k + "in", 6));
      const mid = Math.round(s.span / 2) + jitter(k + "mid", 30);
      const elapsed = Math.round((now - startMs) / 60_000);
      const breaks: BreakPeriod[] = [];
      if (s.breakMinutes > 0 && (ended || elapsed > mid + s.breakMinutes)) breaks.push({ start: stamp(date, s.start, mid), end: stamp(date, s.start, mid + s.breakMinutes + Math.abs(jitter(k + "br", 4))) });
      else if (s.breakMinutes > 0 && !ended && !someoneOnBreak && elapsed > 60) {
        // Live demo: one person on their break right now.
        someoneOnBreak = true;
        breaks.push({ start: stamp(date, s.start, elapsed - 10), end: null });
      }
      const entry: TimeEntry = {
        id: `te-${ws}-${a.employeeId}-${a.shiftId}`.replace(/[:]/g, "-"),
        storeId: store.id,
        employeeId: a.employeeId,
        weekStart: ws,
        shiftId: s.id,
        clockIn,
        clockOut: ended ? stamp(date, s.start, s.span + jitter(k + "out", 12)) : null,
        breaks,
        breakMinutes: breakTotal(breaks),
        source: "kiosk",
        status: !ended ? "open" : ws === week ? "submitted" : "approved",
        note: "",
        approvedBy: ended && ws !== week ? managerEmail : null,
      };
      data.time_entries.push(entry);
    }
  }
}
