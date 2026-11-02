import Link from "next/link";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { aiConfigured, MONTHLY_CAP } from "@/lib/ai";
import { can, requireStore } from "@/lib/auth";
import { PLANS, stripeConfigured } from "@/lib/billing";
import { db, isDemo } from "@/lib/db";
import { prettyDate } from "@/lib/time";
import { ConfirmButton } from "../staff/forms";
import { deleteAllData, manageBilling, resetDemoData, saveOperations, subscribe } from "./actions";
import { hasFeature } from "@/lib/roles";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ billing?: string; delete?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const access = await requireStore(storeId, ["account.billing", "account.admin"]);
  const { store, isPrimary } = access;
  const billing = can(access, "account.billing");
  const adminOn = can(access, "account.admin");
  const d = await db();
  const [calls, log, members] = await Promise.all([
    d.list("ai_calls", { storeId }, { orderBy: "at", desc: true }),
    d.list("audit_log", { storeId }, { orderBy: "at", desc: true, limit: 60 }),
    d.list("store_members", { storeId }),
  ]);
  const month = new Date().toISOString().slice(0, 7);
  const monthCalls = calls.filter((c) => c.at.startsWith(month));
  const cost = monthCalls.reduce((n, c) => n + c.costUsd, 0);
  const tokens = monthCalls.reduce((n, c) => n + c.inputTokens + c.outputTokens, 0);
  const demo = isDemo();

  return (
    <>
      <PageHeader
        title="Settings"
        actions={
          <>
            <Link href={`/s/${storeId}/start`} className="btn-secondary">Getting started</Link>
            {can(access, "shifts.manage") && <Link href={`/s/${storeId}/setup`} className="btn-secondary">Shifts &amp; opening hours</Link>}
            {adminOn && <Link href={`/s/${storeId}/admin`} className="btn-secondary">Roles, access &amp; features</Link>}
          </>
        }
      />
      {sp.billing === "success" && <Notice tone="green">Thanks, your subscription is set up. It can take a few seconds to show here.</Notice>}

      {billing && (
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card" id="billing">
          <h2 className="mb-2 font-semibold">Billing</h2>
          <p className="text-sm">
            Plan: <strong>{store.plan === "trial" ? "Free trial" : PLANS[store.plan].label}</strong>{" "}
            <Badge tone={store.billingStatus === "active" ? "green" : store.billingStatus === "trialing" ? "blue" : "red"}>{store.billingStatus.replace("_", " ")}</Badge>
          </p>
          {store.billingStatus === "trialing" && <p className="mt-1 text-sm text-stone-600">Trial ends {prettyDate(store.trialEndsAt, { day: "numeric", month: "long", year: "numeric" })}.</p>}
          {store.cancelledAt && <p className="mt-1 text-sm text-red-700">Cancelled {prettyDate(store.cancelledAt.slice(0, 10))}. All data is deleted 30 days after cancelling.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {(Object.keys(PLANS) as (keyof typeof PLANS)[]).map((p) => (
              <form key={p} action={subscribe.bind(null, storeId, p)}>
                <button className={store.plan === p && store.billingStatus === "active" ? "btn-secondary" : "btn-primary"} disabled={store.plan === p && store.billingStatus === "active"}>
                  {PLANS[p].label}: {PLANS[p].price}
                </button>
              </form>
            ))}
            {(store.billingStatus === "active" || store.billingStatus === "past_due") && (
              <form action={manageBilling.bind(null, storeId)}>
                <button className="btn-secondary">{stripeConfigured() && store.stripeCustomerId && !demo ? "Manage subscription" : "Cancel subscription"}</button>
              </form>
            )}
          </div>
          <p className="mt-3 text-xs text-stone-500">
            {stripeConfigured() && !demo ? "Payments are handled by Stripe Checkout. 15–20% off for 5+ sites via promotion codes." : "Stripe isn't configured, so these buttons simulate billing (demo)."}
          </p>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">AI usage this month</h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-stone-500">Translations</dt><dd className="text-xl font-semibold">{monthCalls.length}<span className="text-sm text-stone-400">/{MONTHLY_CAP}</span></dd></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-stone-500">Tokens</dt><dd className="text-xl font-semibold">{tokens.toLocaleString("en-GB")}</dd></div>
            <div className="rounded-md bg-stone-50 p-3"><dt className="text-xs text-stone-500">Cost (USD)</dt><dd className="text-xl font-semibold">${cost.toFixed(4)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-stone-500">{aiConfigured() ? "Rules are translated by Claude. Each call is logged with its token count and cost." : "Using the offline demo translator, which costs nothing."} The AI is never used to build rotas.</p>
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold">Access</h2>
          <p className="text-sm">Staff sign-in code: <strong className="font-mono text-lg">{store.joinCode}</strong></p>
          <p className="mt-3 text-sm text-stone-600">Managers: {members.map((m) => `${m.email} (${m.role})`).join(", ")}</p>
          {demo && (
            <p className="mt-3 text-sm">
              <Link href={`/s/${storeId}/outbox`} className="text-brand-700 underline">View the demo email outbox</Link> (swap notifications that would have been sent)
            </p>
          )}
        </section>

        <section className="card" id="danger">
          <h2 className="mb-2 font-semibold">Your data</h2>
          <p className="text-sm text-stone-600">You own this location&apos;s data. Download all of it, or delete it permanently.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/export/${storeId}`} className="btn-secondary">Export everything (JSON)</a>
            {demo && <ConfirmButton action={resetDemoData} label="Reset demo data" confirm="Wipe all changes and restore the demo?" className="btn-secondary" />}
          </div>
          {isPrimary && (
            <form action={deleteAllData.bind(null, storeId)} className="mt-4 space-y-2 border-t border-stone-100 pt-4">
              <label className="label" htmlFor="confirm">To delete everything for this location, type its name: <strong>{store.name}</strong></label>
              <input id="confirm" name="confirm" className="input" autoComplete="off" />
              {sp.delete === "mismatch" && <p className="text-sm text-red-600">The name didn&apos;t match. Nothing was deleted.</p>}
              <button className="btn-danger">Delete all data</button>
            </form>
          )}
        </section>
      </div>
      )}

      {adminOn && (
        <section className="card mt-6" id="operations">
          <h2 className="mb-2 font-semibold">Labour budget &amp; store phone</h2>
          <form action={saveOperations.bind(null, storeId)} className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-4 sm:max-w-xs">
              <label className="label" htmlFor="budget">Weekly labour budget (£)</label>
              <input id="budget" name="weeklyLabourBudget" type="number" min={0} step="1" className="input" defaultValue={store.weeklyLabourBudget ?? ""} disabled={!hasFeature(store.features, "labourCost")} />
              <p className="mt-1 text-xs text-stone-500">{hasFeature(store.features, "labourCost") ? "The rota shows labour cost against this." : "Turn on Labour cost in Admin → Features to use this."}</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="phone">Store phone number</label>
              <input id="phone" name="phone" type="tel" className="input" defaultValue={store.phone ?? ""} placeholder="0113 496 0000" />
              <p className="mt-1 text-xs text-stone-500">Staff get a &ldquo;Call the store&rdquo; button in their app that rings this number.</p>
            </div>
            <div className="flex items-end"><button className="btn-primary w-full">Save</button></div>
          </form>
        </section>
      )}

      {adminOn && (
      <section className="card mt-6 overflow-x-auto">
        <h2 className="mb-2 font-semibold">Audit log</h2>
        <p className="mb-3 text-sm text-stone-600">Who created and confirmed each rule, who approved each rota, and every swap decision. Rules never store a reason.</p>
        <table className="w-full min-w-[600px]">
          <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Details</th></tr></thead>
          <tbody>
            {log.map((e) => (
              <tr key={e.id}>
                <td className="td whitespace-nowrap text-stone-500">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</td>
                <td className="td">{e.actor}</td>
                <td className="td font-mono text-xs">{e.action}</td>
                <td className="td max-w-md truncate font-mono text-xs text-stone-500" title={JSON.stringify(e.details)}>{JSON.stringify(e.details)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
    </>
  );
}
