import "server-only";

/**
 * Fixed-window limiter, in memory. Good enough on one server; with several instances
 * (e.g. Vercel) each has its own window, so put Upstash/Redis behind `hit` for a hard limit.
 */
const g = globalThis as unknown as { __rate?: Map<string, { n: number; reset: number }> };
const windows = (g.__rate ??= new Map());

export function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryInSec: number } {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.reset <= now) {
    windows.set(key, { n: 1, reset: now + windowMs });
    if (windows.size > 10_000) for (const [k, v] of windows) if (v.reset <= now) windows.delete(k);
    return { ok: true, retryInSec: 0 };
  }
  w.n++;
  return { ok: w.n <= limit, retryInSec: Math.ceil((w.reset - now) / 1000) };
}

export const LIMITS = {
  assistant: [30, 10 * 60_000],
  ruleTranslate: [20, 10 * 60_000],
  emailLogin: [5, 15 * 60_000],
  kioskPin: [5, 10 * 60_000],
} as const satisfies Record<string, readonly [number, number]>;

export function limit(kind: keyof typeof LIMITS, who: string) {
  const [n, ms] = LIMITS[kind];
  return hit(`${kind}:${who}`, n, ms);
}

/** Already over the limit? (Doesn't count as an attempt: for limits on failures only.) */
export function blocked(kind: keyof typeof LIMITS, who: string) {
  const w = windows.get(`${kind}:${who}`);
  return !!w && w.reset > Date.now() && w.n >= LIMITS[kind][0];
}
