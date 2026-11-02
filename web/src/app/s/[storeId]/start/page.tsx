import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { can, requireStore } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/roles";
import { storeRoles } from "@/lib/team";

/** Getting-started checklist for a new site: what's done, what's next, one link each. */
export default async function StartPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const access = await requireStore(storeId, ["account.admin", "rota.edit", "staff.manage"]);
  const { store } = access;
  const d = await db();
  const [roles, staff, avail, rules, rotas, entries] = await Promise.all([
    storeRoles(storeId),
    d.list("employees", { storeId, active: true }),
    d.list("availability", { storeId, status: "approved" }),
    d.list("rules", { storeId }),
    d.list("rotas", { storeId }),
    d.list("time_entries", { storeId }),
  ]);
  const withAvail = new Set(avail.map((a) => a.employeeId));
  const base = `/s/${storeId}`;
  const steps = [
    { done: store.shiftTemplates.length > 0, title: "Set your opening hours and shift types", sub: "Times, unpaid breaks, how many people and which roles each shift needs.", href: `${base}/setup`, show: can(access, "shifts.manage") },
    { done: roles.some((r) => !r.system && r.category === "job"), title: "Create your roles", sub: "Jobs like Cook or Front of house, plus who can approve or edit. Presets get you there in one click.", href: `${base}/admin`, show: can(access, "account.admin") },
    { done: staff.length >= 3, title: "Add your team", sub: "One by one, or import a spreadsheet (Deputy and RotaCloud exports work).", href: `${base}/staff`, show: can(access, "staff.manage") },
    { done: staff.length > 0 && staff.every((e) => withAvail.has(e.id)), title: "Get everyone's availability", sub: `${withAvail.size} of ${staff.length} done. Staff can add their own from their phone.`, href: `${base}/staff?status=noAvailability`, show: can(access, "staff.view") },
    { done: rules.length > 0, title: "Write your rules in plain English", sub: "e.g. “Always one keyholder on close”. Optional, but this is where the time savings are.", href: `${base}/rules`, show: can(access, "rules.manage") },
    { done: rotas.length > 0, title: "Generate your first rota", sub: "Built in seconds, legal rest and contract hours always met.", href: `${base}/rota`, show: can(access, "rota.edit") },
    { done: rotas.some((r) => r.status === "approved" || r.published), title: "Publish it", sub: "Staff see it straight away and can swap shifts (you approve).", href: `${base}/rota`, show: can(access, "rota.publish") },
    { done: !!store.holidayPolicy, title: "Check the holiday allowance", sub: "28 days pro rata is set by default. Change it per role or person if you need to.", href: `${base}/admin?tab=holidays`, show: can(access, "account.admin") && hasFeature(store.features, "holidays") },
    { done: entries.length > 0, title: "Set up the clock-in screen", sub: "Open it on a tablet by the door: staff pick their name and enter their PIN to clock in and take breaks.", href: `${base}/timesheets`, show: can(access, "timesheets.approve") && hasFeature(store.features, "clockIn") },
  ].filter((s) => s.show);
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader eyebrow="Getting started" title={done === steps.length ? "You're all set up" : `${done} of ${steps.length} done`} sub="Most sites are fully set up in under an hour." />
      <div className="mb-6 h-2 overflow-hidden rounded-sm bg-zinc-100"><div className="h-full bg-brand-600" style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }} /></div>
      <ol className="card divide-y divide-zinc-100 p-0 sm:p-0">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link href={s.href} className="flex items-center gap-4 px-4 py-4 hover:bg-zinc-50 sm:px-6">
              <span className={`grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{s.done ? <Icon name="check" className="size-4" /> : i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className={`block font-medium ${s.done ? "text-zinc-500 line-through decoration-zinc-300" : ""}`}>{s.title}</span>
                <span className="block text-sm text-zinc-500">{s.sub}</span>
              </span>
              <Icon name="right" className="size-4 text-zinc-300" />
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
