import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, PageHeader, Section } from "@/components/ui";
import { db } from "@/lib/db";
import { DEFAULT_POLICY } from "@/lib/holidays";
import { PUSH_ITEMS, requireOrg } from "@/lib/org-admin";
import { FEATURE_GROUPS, FEATURES, hasFeature, PERMISSIONS, type FeatureKey } from "@/lib/roles";
import { addSiteAction, removeAreaManager, subscribeGroup } from "../actions";
import { LIST_PRICE, volumeDiscount } from "@/lib/billing";
import { money } from "@/lib/pay";
import { isDemo } from "@/lib/db";
import { AreaManagerForm, BrandFeatureRow, BrandHolidayForm, PushForm } from "./client";

export default async function BrandPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const { org, sites, isOwner } = await requireOrg(orgId, true);
  const members = await (await db()).list("org_members", { orgId });
  const siteList = sites.map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <PageHeader eyebrow="Brand & sites" title="Run every site the same way" sub="Set the brand once, copy it to sites, and lock what franchisees mustn't change." />
      <div className="space-y-6">
        <Section title="Copy setup between sites" sub="Make a site match another: roles, shift types and staffing, rules, feature switches and holiday allowance.">
          {sites.length > 1 ? <PushForm orgId={orgId} sites={siteList} items={PUSH_ITEMS} /> : <p className="text-sm text-zinc-500">Add a second site to copy setup between them.</p>}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Brand feature defaults" sub="Locked features are set for every site and can't be changed there. Unlocked ones are just the default.">
            <div className="-my-3.5 divide-y divide-zinc-100">
              {FEATURE_GROUPS.flatMap((g) => (Object.keys(FEATURES) as FeatureKey[]).filter((k) => FEATURES[k].group === g)).map((k) => (
                <BrandFeatureRow key={k} orgId={orgId} k={k} label={FEATURES[k].label} hint={FEATURES[k].hint} value={hasFeature(org.features, k)} locked={(org.lockedFeatures ?? []).includes(k)} />
              ))}
            </div>
          </Section>
          <div className="space-y-6">
            <Section title="Brand holiday allowance" sub="Used by sites that haven't set their own. Lock it to make it the same everywhere.">
              <BrandHolidayForm orgId={orgId} initial={org.holidayPolicy ?? DEFAULT_POLICY} locked={org.lockHolidayPolicy} />
            </Section>
            <Section title="Sites" sub={`${sites.length} in ${org.name}`}>
              <ul className="mb-4 divide-y divide-zinc-100">
                {sites.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-zinc-500">code {s.joinCode}</span>
                    <Link href={`/s/${s.id}/rota`} className="ml-auto text-brand-700 hover:underline">Open</Link>
                  </li>
                ))}
              </ul>
              {isOwner && (
                <form action={addSiteAction.bind(null, orgId)} className="flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-4">
                  <div className="min-w-48 flex-1"><label className="label" htmlFor="newsite">Add a site</label><input id="newsite" name="name" className="input" placeholder="e.g. Test Wings, Sheffield" required /></div>
                  <div><label className="label" htmlFor="copyFrom">Set up like</label>
                    <select id="copyFrom" name="copyFrom" className="input" defaultValue={sites[0]?.id ?? ""}>
                      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="">Start empty</option>
                    </select>
                  </div>
                  <button className="btn-primary"><Icon name="plus" className="size-4" />Add</button>
                </form>
              )}
            </Section>
          </div>
        </div>

        {isOwner && (() => {
          const n = sites.length;
          const disc = volumeDiscount(n);
          return (
            <Section title="Group billing" sub="One subscription covers every site in the group, with volume pricing.">
              <p className="text-sm">
                Status: <Badge tone={org.billingStatus === "active" ? "green" : "grey"}>{org.billingStatus === "active" ? `Active · ${org.plan}` : "Each site billed separately (or on trial)"}</Badge>
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {(["starter", "pro"] as const).map((p) => {
                  const per = LIST_PRICE[p] * (1 - disc);
                  return (
                    <form key={p} action={subscribeGroup.bind(null, orgId, p)} className="rounded-lg border border-zinc-200 p-4">
                      <p className="font-semibold capitalize">{p}</p>
                      <p className="text-sm text-zinc-600">{money(per)} per site / month{disc ? ` (${disc * 100}% volume discount)` : ""}</p>
                      <p className="mt-1 text-lg font-semibold">{money(per * n)} / month for {n} site{n === 1 ? "" : "s"}</p>
                      <button className="btn-primary btn-sm mt-3" disabled={org.billingStatus === "active" && org.plan === p}>{org.billingStatus === "active" && org.plan === p ? "Current plan" : "Subscribe the group"}</button>
                    </form>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-zinc-500">15% off from 5 sites, 20% off from 10. {isDemo() ? "Demo: subscribing is simulated." : ""}</p>
            </Section>
          );
        })()}

        {isOwner && (
          <Section title="Area managers" sub="People who look after several sites. They sign in by email and get these permissions at the sites you choose.">
            <ul className="mb-5 divide-y divide-zinc-100">
              {members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                  <span className="font-medium break-all">{m.email}</span>
                  {m.role === "owner" ? <Badge tone="violet" icon="shield">Group owner · everything</Badge> : (
                    <>
                      {!m.userId && <Badge tone="amber">Invited</Badge>}
                      <Badge>{m.storeIds === null ? "All sites" : `${m.storeIds.length} site${m.storeIds.length === 1 ? "" : "s"}`}</Badge>
                      <span className="text-xs text-zinc-500">{m.permissions.map((p) => PERMISSIONS[p]?.label).filter(Boolean).slice(0, 3).join(", ")}{m.permissions.length > 3 ? ` +${m.permissions.length - 3}` : ""}</span>
                      <form action={removeAreaManager.bind(null, orgId, m.id)} className="ml-auto"><button className="text-xs text-red-600 hover:underline">Remove</button></form>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <AreaManagerForm orgId={orgId} sites={siteList} />
          </Section>
        )}
      </div>
    </>
  );
}
