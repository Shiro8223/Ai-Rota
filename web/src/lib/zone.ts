/**
 * The current wall-clock time in a store's timezone, as a Date whose local fields read like
 * that wall clock. Shift times are wall-clock times, so comparing against this keeps the
 * 24-hour rule right wherever the server runs.
 */
export function zonedNow(timeZone = "Europe/London", at = new Date()): Date {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return new Date(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  } catch {
    return at;
  }
}
