import Link from "next/link";
import { notFound } from "next/navigation";
import { AvailabilityEditor, TemporaryAvailabilityForm } from "@/components/availability-editor";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Notice, Section } from "@/components/ui";
import { RoleChip } from "@/components/role-chip";
import { can, requireStore } from "@/lib/auth";
import { hasFeature } from "@/lib/roles";
import { orgStores } from "@/lib/org";
import { storeRoles, roleOptions } from "@/lib/team";
import { db } from "@/lib/db";
import { tempRange, windowsText } from "@/lib/format";
import { DAY_NAME, DAYS } from "@/lib/types";
import { emptyWeek, mondayOf, upcomingWeeks } from "@/lib/time";
import { addTemporary, removeAvailability, removeEmployee, resetPin, saveCompliance, saveUsualAvailability, setAllowedSites, updateEmployee } from "../actions";
import { ComplianceForm } from "./compliance-form";
import { complianceFlags } from "@/lib/compliance";
import { ConfirmButton, EmployeeForm, ResetPinButton } from "../forms";

export default async function EmployeePage({ params }: { params: Promise<{ storeId: string; employeeId: string }> }) {
  const { storeId, employeeId } = await params;
  const access = await requireStore(storeId, "staff.view");
  const manage = can(access, "staff.manage");
  const temporaryOn = hasFeature(access.store.features, "temporaryAvailability");
  const d = await db();
  const allRoles = await storeRoles(storeId);
  const sisters = access.store.orgId ? (await orgStores(access.store.orgId)).filter((s) => s.id !== storeId) : [];
  const e = await d.get("employees", employeeId);
  if (!e || e.storeId !== storeId) notFound();
  const flags = complianceFlags([e], allRoles);
  const rows = await d.list("availability", { storeId, employeeId });
  const usual = rows.find((a) => a.kind === "default" && a.status === "approved");
  const pending = rows.filter((a) => a.status === "pending");
  const temps = rows.filter((a) => a.kind === "temporary" && a.status !== "declined" && a.endWeek! >= mondayOf()).sort((a, b) => a.startWeek!.localeCompare(b.startWeek!));

  return (
    <>
      <Link href={`/s/${storeId}/staff`} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-900"><Icon name="left" className="size-4" />All staff</Link>
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={e.name} size="lg" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{e.name}</h1>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {allRoles.filter((r) => (e.roleIds ?? []).includes(r.id)).map((r) => <RoleChip key={r.id} role={r} />)}
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <Notice tone="amber">
          {e.name.split(" ")[0]} has {pending.length} availability change{pending.length > 1 ? "s" : ""} waiting for approval. <Link href={`/s/${storeId}/approvals`} className="font-semibold underline">Review in Approvals</Link>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {flags.length > 0 && (
            <Notice tone={flags.some((f) => f.severity === "error") ? "red" : "amber"}>
              <ul className="space-y-1">{flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
            </Notice>
          )}
          {manage && (
            <Section title="Compliance & pay" sub="Minimum wage band, right to work, the 48-hour opt-out and qualification expiry dates. Pay is only visible to people with the pay permission and is never sent to the AI.">
              <ComplianceForm
                action={saveCompliance.bind(null, storeId, employeeId)}
                employee={e}
                showPay={can(access, "pay.view") && hasFeature(access.store.features, "labourCost")}
                qualifications={allRoles.filter((r) => r.category === "qualification" && (e.roleIds ?? []).includes(r.id)).map((r) => ({ id: r.id, name: r.name }))}
              />
            </Section>
          )}
          {manage && sisters.length > 0 && (
            <Section title="Also works at" sub="Other sites in the group this person can be rostered at. Rest, weekly hours and their contract are checked across all sites.">
              <form action={setAllowedSites.bind(null, storeId, employeeId)} className="space-y-2">
                {sisters.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" name="sites" value={s.id} defaultChecked={(e.allowedStoreIds ?? []).includes(s.id)} className="size-4 accent-brand-600" />
                    {s.name}
                  </label>
                ))}
                <button className="btn-secondary btn-sm mt-2">Save sites</button>
              </form>
            </Section>
          )}
          <Section title="Details">
            {manage ? (
              <>
                <EmployeeForm action={updateEmployee.bind(null, storeId, employeeId)} employee={e} submit="Save details" roles={roleOptions(allRoles)} canGrantAccess={can(access, "account.admin")} />
                <div className="mt-6 flex flex-wrap items-start gap-3 border-t border-zinc-100 pt-5">
                  <ResetPinButton action={resetPin.bind(null, storeId, employeeId)} />
                  <ConfirmButton action={removeEmployee.bind(null, storeId, employeeId)} label="Remove from store" confirm={`Delete ${e.name.split(" ")[0]}'s record, availability and rules naming them?`} className="btn-ghost text-red-600" />
                </div>
              </>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-zinc-500">Started</dt><dd className="font-medium">{e.startDate}</dd></div>
                <div><dt className="text-zinc-500">Hours</dt><dd className="font-medium">{e.contractedHours}h contract · {e.maxHoursPerWeek}h max</dd></div>
              </dl>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Usual availability" sub="The weekly pattern used for every rota unless a temporary one applies.">
            {manage ? (
              <AvailabilityEditor
                key={usual?.updatedAt ?? "none"}
                initial={usual?.days ?? emptyWeek()}
                onSave={saveUsualAvailability.bind(null, storeId, employeeId)}
                hint={usual ? undefined : "No availability yet, so the solver won't schedule them. They can also fill this in from their phone."}
              />
            ) : (
              <dl className="divide-y divide-zinc-100 text-sm">
                {DAYS.map((day) => <div key={day} className="flex justify-between py-2"><dt className="font-medium">{DAY_NAME[day]}</dt><dd className="text-zinc-600">{windowsText(usual?.days[day])}</dd></div>)}
              </dl>
            )}
          </Section>

          {temporaryOn && <Section
            title="Temporary availability"
            sub={e.isStudent ? "For term time, exams or holidays. It switches back to the usual pattern by itself." : "For a few weeks of different hours. It switches back to the usual pattern by itself."}
          >
            {temps.length > 0 && (
              <ul className="mb-5 space-y-2">
                {temps.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 text-sm">
                    <Icon name="calendar" className="size-4 text-violet-600" />
                    <span className="font-medium">{t.note || "Temporary"}</span>
                    <span className="text-zinc-500">{tempRange(t)}</span>
                    {t.status === "pending" ? <Badge tone="amber">Waiting for approval</Badge> : <Badge tone="green">Approved</Badge>}
                    {manage && <form action={removeAvailability.bind(null, storeId, t.id)} className="ml-auto"><button className="btn-ghost btn-sm text-red-600">Remove</button></form>}
                  </li>
                ))}
              </ul>
            )}
            {manage && <TemporaryAvailabilityForm weeks={upcomingWeeks(16)} initial={usual?.days ?? emptyWeek()} onSubmit={addTemporary.bind(null, storeId, employeeId)} submitLabel="Add temporary availability" />}
          </Section>}
        </div>
      </div>
    </>
  );
}
