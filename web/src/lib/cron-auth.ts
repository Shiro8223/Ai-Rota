import "server-only";
import { safeEqual } from "./crypto";

/** Vercel Cron (and any scheduler) sends Authorization: Bearer $CRON_SECRET. */
export function cronAuthorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  return !!secret && safeEqual(got, `Bearer ${secret}`);
}
