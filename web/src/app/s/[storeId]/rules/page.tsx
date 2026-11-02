import { Badge, Notice, PageHeader } from "@/components/ui";
import { aiConfigured, MONTHLY_CAP, translationsThisMonth } from "@/lib/ai";
import { requireStore } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { db } from "@/lib/db";
import { prettyDate } from "@/lib/time";
import { ConfirmButton } from "../staff/forms";
import { addRule, confirmRule, deleteRule } from "./actions";
import { RuleBox } from "./forms";

export default async function RulesPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const { store } = await requireStore(storeId, "rules.manage");
  const aiOn = hasFeature(store.features, "aiRules");
  const d = await db();
  const rules = await d.list("rules", { storeId }, { orderBy: "createdAt" });
  const used = await translationsThisMonth(storeId);
  const pending = rules.filter((r) => r.status === "pending");
  const confirmed = rules.filter((r) => r.status === "confirmed");

  return (
    <>
      <PageHeader title="Rules" sub="Write rules the way you'd say them. The AI turns each into a precise rule, you check it reads right, and only confirmed rules are used." />
      {!aiConfigured() && (
        <Notice tone="blue">
          Demo translator: no Anthropic API key is set, so rules are read by a built-in offline translator that knows common phrasings. Set <code>ANTHROPIC_API_KEY</code> to use Claude.
        </Notice>
      )}

      {aiOn ? (
      <section className="card mb-6">
        <h2 className="mb-2 font-semibold">Add a rule</h2>
        <RuleBox action={addRule.bind(null, storeId, null)} />
        <p className="mt-2 text-xs text-stone-500">{used} of {MONTHLY_CAP} rule translations used this month.</p>
      </section>
      ) : (
        <Notice tone="amber">Plain-English rules are switched off in Admin → Features. Existing rules still apply.</Notice>
      )}

      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Waiting for you to check ({pending.length})</h2>
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="card border-amber-200">
                <p className="text-sm text-stone-500">You wrote: “{r.originalText}”</p>
                <p className="mt-1 font-medium">Understood: {r.summary}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={confirmRule.bind(null, storeId, r.id)}>
                    <button className="btn-primary">Yes, that&apos;s right</button>
                  </form>
                  <details className="w-full sm:w-auto">
                    <summary className="btn-secondary cursor-pointer list-none">No, reword it</summary>
                    <div className="mt-2 w-full sm:w-96">
                      <RuleBox action={addRule.bind(null, storeId, r.id)} initial={r.originalText} compact />
                    </div>
                  </details>
                  <form action={deleteRule.bind(null, storeId, r.id)}>
                    <button className="btn-ghost text-red-600">Discard</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Active rules ({confirmed.length})</h2>
        <div className="card divide-y divide-stone-100 p-0 sm:p-0">
          {confirmed.map((r) => (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.summary}</p>
                <p className="mt-0.5 text-xs text-stone-500">
                  “{r.originalText}” · confirmed by {r.confirmedBy} {r.confirmedAt && `on ${prettyDate(r.confirmedAt.slice(0, 10))}`}{" "}
                  <Badge tone={r.constraint.hard ? "grey" : "blue"}>{r.constraint.hard ? "must" : "preference"}</Badge>{" "}
                  {r.weekStart && <Badge tone="violet">Week of {prettyDate(r.weekStart)} only</Badge>}
                </p>
              </div>
              <ConfirmButton action={deleteRule.bind(null, storeId, r.id)} label="Delete" confirm="Delete this rule?" className="btn-ghost text-red-600" />
            </div>
          ))}
          {!confirmed.length && <p className="p-4 text-sm text-stone-500">No active rules. Built-in rules (availability, staffing levels, max hours, 11h rest, under-18 limits) always apply.</p>}
        </div>
        <p className="mt-2 text-xs text-stone-500">Always applied: staff availability, min/max staff per shift, one shift per person per day, weekly hour limits, 11 hours&apos; rest between shifts, and UK young-worker limits.</p>
      </section>
    </>
  );
}
