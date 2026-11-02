import "server-only";
import { audit } from "./audit";
import { wallNow } from "./clock";
import { db } from "./db";
import { liveAssignments, lockState } from "./live";
import { notify } from "./notify";
import { loadStore } from "./org";
import { hasFeature } from "./roles";
import { purgeCancelled } from "./store-data";
import { purgeLoginCodes } from "./login";
import { alertNoShows } from "./timesheets";
import { addDays, dayDate, mondayOf, parseDate, shiftsForStore } from "./time";
import { zonedNow } from "./zone";
import { DAYS } from "./types";

/** Suggested changes nobody answered before the shift started: mark them expired. */
export async function expireChangeRequests() {
  const d = await db();
  let n = 0;
  for (const c of await d.list("change_requests", { status: "pending" })) {
    const store = await loadStore(c.storeId);
    const s = store && shiftsForStore(store).find((x) => x.id === c.shiftId);
    if (!store || !s) continue;
    if (lockState(c.weekStart, DAYS.indexOf(s.day), s.start, zonedNow(store.timezone)) === "past") {
      await d.update("change_requests", c.id, { status: "expired", respondedAt: new Date().toISOString() });
      n++;
    }
  }
  return n;
}

/**
 * Evening-before reminders. Runs from the frequent job; sends once per store per day,
 * after 17:00 site time.
 */
export async function sendReminders() {
  const d = await db();
  let sent = 0;
  for (const raw of await d.list("stores")) {
    const store = await loadStore(raw.id);
    if (!store || store.cancelledAt || !hasFeature(store.features, "reminders")) continue;
    const wall = wallNow(store.timezone);
    if (+wall.slice(11, 13) < 17) continue;
    const today = wall.slice(0, 10);
    const already = (await d.list("audit_log", { storeId: store.id, action: "reminders.sent" })).some((l) => (l.details as { date?: string }).date === today);
    if (already) continue;
    const tomorrow = addDays(today, 1);
    const week = mondayOf(parseDate(tomorrow));
    const rota = (await d.list("rotas", { storeId: store.id, weekStart: week }))[0];
    const live = rota ? liveAssignments(rota) : null;
    let count = 0;
    if (live) {
      const shifts = shiftsForStore(store).filter((s) => dayDate(week, s.day) === tomorrow);
      for (const s of shifts) {
        for (const a of live.filter((x) => x.shiftId === s.id)) {
          const e = await d.get("employees", a.employeeId);
          if (!e?.active) continue;
          await notify(store.id, e, `Tomorrow: ${s.name} ${s.start}–${s.end}`, `Reminder: you're working ${s.name} at ${store.name} tomorrow, ${s.start}–${s.end}.`);
          count++;
        }
      }
    }
    await audit(store.id, "system", "reminders.sent", { date: today, count });
    sent += count;
  }
  return sent;
}

/** Every ~15 minutes: no-show alerts and reminders. */
export async function runFrequent() {
  const d = await db();
  let noShows = 0;
  for (const raw of await d.list("stores")) {
    const store = await loadStore(raw.id);
    if (store && !store.cancelledAt) noShows += await alertNoShows(store);
  }
  return { noShows, reminders: await sendReminders() };
}

/** Once a day: tidy-up and the 30-day purge of cancelled accounts. */
export async function runDaily() {
  const expired = await expireChangeRequests();
  const purged = await purgeCancelled();
  const codes = await purgeLoginCodes();
  return { expired, purged, codes };
}
