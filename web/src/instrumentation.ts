import type { Instrumentation } from "next";

/**
 * Server errors go to MONITORING_WEBHOOK (any endpoint that accepts JSON: Slack, Sentry
 * tunnel, Better Stack...). Only the route and error message are sent: no request bodies,
 * cookies or personal data.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const url = process.env.MONITORING_WEBHOOK;
  const e = err as Error & { digest?: string };
  console.error("[request error]", context.routePath, e?.message);
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `Rota Agent error on ${request.method} ${context.routePath}: ${String(e?.message ?? err).slice(0, 300)}`,
        route: context.routePath,
        kind: context.routeType,
        digest: e?.digest ?? null,
        at: new Date().toISOString(),
      }),
    });
  } catch {
    // never let reporting break the request
  }
};
