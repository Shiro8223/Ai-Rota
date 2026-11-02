import Link from "next/link";
import { Icon } from "@/components/icons";
import { RoleChip } from "@/components/role-chip";
import { Avatar, Badge, PageHeader, Section, Tabs } from "@/components/ui";
import { requireStore } from "@/lib/auth";
import { orgOf } from "@/lib/org";
import { colorOf } from "@/lib/colors";
import { db } from "@/lib/db";
import { FEATURE_GROUPS, FEATURE_PRESETS, FEATURES, hasFeature, PERMISSIONS, ROLE_CATEGORIES, ROLE_PRESETS, type FeatureKey, type RoleCategory } from "@/lib/roles";
import { permissionsOf, roleOptions, storeRoles } from "@/lib/team";
import { applyFeaturePreset, removeMember } from "./actions";
import { FeatureSwitch, InviteForm, MemberRoles, PresetApply, RoleEditor, type RoleDraft } from "./client";
import { HolidayPolicyForm, PersonPicker } from "./holiday-client";
import { DEFAULT_POLICY, policyFor } from "@/lib/holidays";
import { holidayBalance } from "@/lib/holiday-server";

type Tab = "roles" | "team" | "features" | "holidays";

export default async function AdminPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ tab?: string; edit?: string; person?: string }> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === "team" || sp.tab === "features" || sp.tab === "holidays" ? sp.tab : "roles";
  const { store, isPrimary, actor } = await requireStore(storeId, "account.admin");
  const d = await db();
  const [roles, employees, members, holidays] = await Promise.all([storeRoles(storeId), d.list("employees", { storeId, active: true }, { orderBy: "name" }), d.list("store_members", { storeId }), d.list("holidays", { storeId })]);
  const people = (roleId: string) => employees.filter((e) => (e.roleIds ?? []).includes(roleId)).length + members.filter((m) => (m.roleIds ?? []).includes(roleId)).length;
  const options = roleOptions(roles);
  const org = await orgOf(store);
  const hasCustomRoles = roles.some((r) => !r.system);
  // Accrual policies need hours worked, so balances come from the server helper.
  const balances = tab === "holidays" ? Object.fromEntries(await Promise.all(employees.map(async (e) => [e.id, await holidayBalance(store, e)] as const))) : {};

  const editing: RoleDraft | null =
    sp.edit === "new"
      ? { id: null, name: "", category: "job", color: "sky", description: "", permissions: [], system: null, people: 0, hourlyRate: null }
      : (() => {
          const r = roles.find((x) => x.id === sp.edit);
          return r ? { id: r.id, name: r.name, category: r.category, color: r.color, description: r.description, permissions: r.permissions, system: r.system, people: people(r.id), hourlyRate: r.hourlyRate ?? null } : null;
        })();

  return (
    <>
      <PageHeader
        eyebrow={<span className="flex items-center gap-1.5"><Icon name="shield" className="size-3.5" />Admin{isPrimary && " · Account Primary"}</span>}
        title="Roles, access & features"
        sub="Set up who does what, who can see what, and which parts of the app your team uses."
      />
      <Tabs
        active={tab}
        items={[
          { key: "roles", label: "Roles & permissions", href: "?tab=roles" },
          { key: "team", label: "Team access", href: "?tab=team" },
          { key: "features", label: "Features", href: "?tab=features" },
          { key: "holidays", label: "Holidays", href: "?tab=holidays" },
        ]}
      />

      {tab === "roles" && editing && (
        <Section title={editing.id ? `Edit “${editing.name}”` : "New role"} sub={editing.system ? "Built-in role. Rename it if you like; it keeps its meaning." : undefined}>
          <RoleEditor storeId={storeId} role={editing} onDoneHref="?tab=roles" />
        </Section>
      )}

      {tab === "roles" && !editing && (
        <div className="space-y-6">
          {/* Presets are a starting point: once the store has its own roles they're hidden. */}
          {hasCustomRoles ? (
            <div className="flex justify-end">
              <Link href="?tab=roles&edit=new" className="btn-primary"><Icon name="plus" className="size-4" />New role</Link>
            </div>
          ) : (
          <section className="card bg-gradient-to-br from-brand-50/70 to-white">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Quick start with a preset</h2>
                <p className="text-sm text-zinc-600">Adds any roles you don&apos;t have yet. Nothing is removed, and you can edit everything afterwards.</p>
              </div>
              <Link href="?tab=roles&edit=new" className="btn-primary"><Icon name="plus" className="size-4" />New role</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {ROLE_PRESETS.map((p) => (
                <div key={p.key} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="font-semibold">{p.label}</p>
                  <p className="mb-3 text-xs text-zinc-500">{p.hint}</p>
                  <div className="mb-3 flex flex-wrap gap-1">
                    {p.roles.filter((r) => r.category === "access" || r.category === "job").map((r) => (
                      <span key={r.name} className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">{r.name}</span>
                    ))}
                  </div>
                  <PresetApply storeId={storeId} presetKey={p.key} label={p.label} />
                </div>
              ))}
            </div>
          </section>
          )}

          {(Object.keys(ROLE_CATEGORIES) as RoleCategory[]).map((cat) => {
            const list = roles.filter((r) => r.category === cat);
            return (
              <section key={cat}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="eyebrow">{ROLE_CATEGORIES[cat].label}</h2>
                  <p className="hidden text-xs text-zinc-500 sm:block">{ROLE_CATEGORIES[cat].hint}</p>
                </div>
                <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                  {list.map((r) => {
                    const c = colorOf(r.color);
                    const n = people(r.id);
                    return (
                      <Link key={r.id} href={`?tab=roles&edit=${r.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-zinc-50 sm:px-6">
                        <span className={`size-3 shrink-0 rounded-full ${c.dot}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{r.name}</span>
                            {r.system && <Badge>Built in</Badge>}
                          </div>
                          {r.description && <p className="truncate text-xs text-zinc-500">{r.description}</p>}
                        </div>
                        <div className="hidden flex-wrap justify-end gap-1 md:flex md:max-w-md">
                          {r.permissions.length === 0 ? (
                            <span className="text-xs text-zinc-400">Staff app only</span>
                          ) : r.permissions.length === Object.keys(PERMISSIONS).length ? (
                            <Badge tone="violet" icon="shield">Full access</Badge>
                          ) : (
                            <Badge tone="blue" icon="shield">{r.permissions.length} permission{r.permissions.length > 1 ? "s" : ""}</Badge>
                          )}
                        </div>
                        <span className="w-20 shrink-0 text-right text-xs text-zinc-500">{n} {n === 1 ? "person" : "people"}</span>
                        <Icon name="right" className="size-4 text-zinc-300" />
                      </Link>
                    );
                  })}
                  {!list.length && <p className="px-4 py-4 text-sm text-zinc-500 sm:px-6">None yet.</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {tab === "team" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Section title="Managers who sign in by email">
              <ul className="divide-y divide-zinc-100">
                {members.map((m) => (
                  <li key={m.id} className="py-4 first:pt-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Avatar name={m.email} size="sm" />
                      <span className="font-medium break-all">{m.email}</span>
                      {m.role === "owner" ? <Badge tone="violet" icon="shield">Account Primary · full access</Badge> : !m.userId ? <Badge tone="amber">Invited</Badge> : null}
                      {m.email === actor && <Badge>You</Badge>}
                    </div>
                    {m.role !== "owner" && (
                      <div className="pl-9">
                        <MemberRoles storeId={storeId} memberId={m.id} roles={options} initial={m.roleIds ?? []} />
                        <form action={removeMember.bind(null, storeId, m.id)} className="mt-2"><button className="text-xs text-red-600 hover:underline">Remove access</button></form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Invite a manager" sub="They sign in with this email. Pick the access roles they get.">
              <InviteForm storeId={storeId} roles={options} />
            </Section>
          </div>
          <Section title="Staff with manager tools" sub="People who sign in on their phone with a PIN and hold a role with permissions. Change their roles on their staff page.">
            <ul className="divide-y divide-zinc-100">
              {employees
                .filter((e) => permissionsOf(e.roleIds ?? [], roles).size > 0)
                .map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                    <Avatar name={e.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/s/${storeId}/staff/${e.id}`} className="font-medium hover:underline">{e.name}</Link>
                      <div className="mt-1 flex flex-wrap gap-1">{roles.filter((r) => (e.roleIds ?? []).includes(r.id) && r.permissions.length).map((r) => <RoleChip key={r.id} role={r} />)}</div>
                    </div>
                    <span className="text-xs text-zinc-500">{permissionsOf(e.roleIds ?? [], roles).size} permissions</span>
                  </li>
                ))}
              {!employees.some((e) => permissionsOf(e.roleIds ?? [], roles).size > 0) && <p className="text-sm text-zinc-500">Nobody yet.</p>}
            </ul>
          </Section>
        </div>
      )}

      {tab === "holidays" && (() => {
        const general = store.holidayPolicy ?? DEFAULT_POLICY;
        const picked = employees.find((e) => e.id === sp.person);
        const overridden = employees.filter((e) => e.holidayPolicy);
        return (
          <div className="space-y-6">
            <Section title="General allowance" sub="Applies to everyone unless their role or their own setting says otherwise. The most specific setting wins: person, then role, then this.">
              {org?.lockHolidayPolicy ? (
                <p className="flex items-center gap-2 text-sm text-zinc-600"><Icon name="lock" className="size-4" />{org.name} sets this for every site: {general.allowance} {general.unit} per {general.period}{general.proRata ? ", pro rata" : ""}. You can still give roles or individuals more below.</p>
              ) : (
                <HolidayPolicyForm storeId={storeId} target="store" initial={general} removable={false} />
              )}
            </Section>

            <Section title="By role" sub="For example, a bigger allowance for managers. If someone has several roles with allowances, the largest applies.">
              <div className="divide-y divide-zinc-100">
                {roles.filter((r) => r.category !== "status").map((r) => (
                  <details key={r.id} className="group py-3" open={!!r.holidayPolicy && false}>
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <RoleChip role={r} />
                      <span className="text-sm text-zinc-500">{r.holidayPolicy ? `${r.holidayPolicy.allowance} ${r.holidayPolicy.unit} per ${r.holidayPolicy.period}${r.holidayPolicy.proRata ? ", pro rata" : ""}` : "Uses the general allowance"}</span>
                      <Icon name="right" className="ml-auto size-4 text-zinc-400 transition group-open:rotate-90" />
                    </summary>
                    <div className="mt-3">
                      <HolidayPolicyForm storeId={storeId} target={`role:${r.id}`} initial={r.holidayPolicy ?? general} removable={!!r.holidayPolicy} fallbackLabel="the general allowance" />
                    </div>
                  </details>
                ))}
              </div>
            </Section>

            <Section title="For individual people" sub="Overrides everything else, e.g. extra days agreed in someone's contract.">
              <PersonPicker people={employees.map((e) => ({ id: e.id, name: e.name }))} />
              {picked && (
                <div className="mt-4 rounded-lg border border-zinc-200 p-4">
                  <p className="mb-3 font-semibold">{picked.name}</p>
                  <HolidayPolicyForm key={picked.id} storeId={storeId} target={`person:${picked.id}`} initial={picked.holidayPolicy ?? policyFor({ ...picked, holidayPolicy: null }, roles, store).policy} removable={!!picked.holidayPolicy} fallbackLabel="their role or the general allowance" />
                </div>
              )}
              {overridden.length > 0 && (
                <p className="mt-4 text-sm text-zinc-600">
                  People with their own allowance:{" "}
                  {overridden.map((e, i) => (
                    <span key={e.id}>{i > 0 && ", "}<Link className="underline" href={`?tab=holidays&person=${e.id}`}>{e.name}</Link></span>
                  ))}
                </p>
              )}
            </Section>

            <Section title="Balances" sub="This period's allowance for each person after pro rata, and what's booked.">
              <div className="-mx-4 overflow-x-auto sm:-mx-6">
                <table className="w-full min-w-[640px]">
                  <thead><tr><th className="th">Person</th><th className="th">From</th><th className="th">Allowance</th><th className="th">Used</th><th className="th">Pending</th><th className="th">Left</th><th className="th">Period</th></tr></thead>
                  <tbody>
                    {employees.map((e) => {
                      const b = balances[e.id];
                      return (
                        <tr key={e.id}>
                          <td className="td font-medium">{e.name}</td>
                          <td className="td text-zinc-500">{b.from === "person" ? "Personal" : b.from === "role" ? b.roleName : "General"}</td>
                          <td className="td tabular-nums">{b.allowance} {b.unit}</td>
                          <td className="td tabular-nums">{b.used}</td>
                          <td className="td tabular-nums">{b.pending}</td>
                          <td className={`td font-semibold tabular-nums ${b.remaining < 0 ? "text-red-600" : ""}`}>{b.remaining}</td>
                          <td className="td text-xs text-zinc-500">{b.period.start} → {b.period.end}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        );
      })()}

      {tab === "features" && (
        <div className="space-y-6">
          <section className="card">
            <h2 className="font-semibold">Presets</h2>
            <p className="mb-4 text-sm text-zinc-600">Pick a starting point, then fine-tune the switches below.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {FEATURE_PRESETS.map((p) => {
                const active = (Object.keys(p.features) as FeatureKey[]).every((k) => p.features[k] === hasFeature(store.features, k));
                return (
                  <form key={p.key} action={applyFeaturePreset.bind(null, storeId, p.key)}>
                    <button className={`h-full w-full rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-zinc-200 hover:border-zinc-300"}`}>
                      <p className="flex items-center gap-2 font-semibold">{p.label}{active && <Icon name="check" className="size-4 text-brand-600" />}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{p.hint}</p>
                    </button>
                  </form>
                );
              })}
            </div>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            {FEATURE_GROUPS.map((g) => (
              <Section key={g} title={g}>
                <div className="-my-3.5 divide-y divide-zinc-100">
                  {(Object.keys(FEATURES) as FeatureKey[]).filter((k) => FEATURES[k].group === g).map((k) => (
                    <FeatureSwitch key={k} storeId={storeId} k={k} on={hasFeature(store.features, k)} label={FEATURES[k].label} hint={FEATURES[k].hint} lockedBy={org?.lockedFeatures?.includes(k) ? org.name : undefined} />
                  ))}
                </div>
              </Section>
            ))}
          </div>
          <p className="text-xs text-zinc-500">Legal checks (rest between shifts, weekly rest, under-18 limits) can&apos;t be switched off.</p>
        </div>
      )}
    </>
  );
}
