import { addDays, prettyDate } from "./time";
import type { Availability, Window } from "./types";

export function windowsText(w: Window[] | undefined) {
  if (!w || !w.length) return "Off";
  if (w.length === 1 && w[0].from === "00:00" && (w[0].to === "24:00" || w[0].to === "23:59")) return "Any time";
  return w.map((x) => `${x.from}–${x.to}`).join(", ");
}

export function tempRange(a: Pick<Availability, "startWeek" | "endWeek">) {
  if (!a.startWeek || !a.endWeek) return "";
  const weeks = Math.round((new Date(a.endWeek).getTime() - new Date(a.startWeek).getTime()) / (7 * 86_400_000)) + 1;
  return `${prettyDate(a.startWeek)} – ${prettyDate(addDays(a.endWeek, 6))} · ${weeks} week${weeks > 1 ? "s" : ""}`;
}
