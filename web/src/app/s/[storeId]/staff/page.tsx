import Link from "next/link";
import { Icon } from "@/components/icons";
import { RoleChip } from "@/components/role-chip";
import { Avatar, Badge, PageHeader, Section } from "@/components/ui";
import { activeTemporary } from "@/lib/availability";
import { complianceFlags } from "@/lib/compliance";
import { can, requireStore } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature, ROLE_CATEGORIES, type RoleCategory } from "@/lib/roles";
import { roleOptions, storeRoles } from "@/lib/team";
import { mondayOf, parseDate } from "@/lib/time";
import { addEmployee } from "./actions";
import { EmployeeForm } from "./forms";

const PAGE_SIZE = 10;
const STATUS_FILTERS = {
  new: "New starters (under 90 days)",
  noAvailability: "No availability set",
  pending: "Availability change to approve",
  temporary: "On a temporary pattern",
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;
type SP = { q?: string; role?: string; status?: string; sort?: string; page?: string; add?: string };

export default async function StaffPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<SP> }) {
  const { storeId } = await params;
  const sp = await searchParams;
  const access = await requireStore(storeId, "staff.view");
  const { store } = access;
  const d = await db();
  const [employees, avail, roles] = await Promise.all([d.list("employees", { storeId }, { orderBy: "name" }), d.list("availability", { storeId }), storeRoles(storeId)]);
  const today = new Date();
  const week = mondayOf();
  const manage = can(access, "staff.manage");
  const flags = complianceFlags(employees.filter((e) => e.active), roles);
  const flagsFor = (id: string) => flags.filter((f) => f.employeeId === id);

  // ---------------------------------------------------------------- search, filter, sort, page
  const q = (sp.q ?? "").trim().toLowerCase();
  const roleId = roles.some((r) => r.id === sp.role) ? sp.role! : "";
  const status = (sp.status && sp.status in STATUS_FILTERS ? sp.status : "") as StatusFilter | "";
  const sort = sp.sort === "hours" || sp.sort === "start" ? sp.sort : "name";
  const info = (id: string) => {
    const rows = avail.filter((a) => a.employeeId === id);
    return {
      usual: rows.some((a) => a.kind === "default" && a.status === "approved"),
      pending: rows.some((a) => a.status === "pending"),
      temp: activeTemporary(rows, id, week),
    };
  };
  const tenure = (start: string) => Math.floor((today.getTime() - parseDate(start).getTime()) / 86_400_000);
  const filtered = employees
    .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.email ?? "").toLowerCase().includes(q) || e.role.toLowerCase().includes(q))
    .filter((e) => !roleId || (e.roleIds ?? []).includes(roleId))
    .filter((e) => {
      if (!status) return true;
      const i = info(e.id);
      return status === "new" ? tenure(e.startDate) < 90 : status === "noAvailability" ? !i.usual : status === "pending" ? i.pending : !!i.temp;
    })
    .sort((a, b) => (sort === "hours" ? b.contractedHours - a.contractedHours : sort === "start" ? a.startDate.localeCompare(b.startDate) : a.name.localeCompare(b.name)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const qs = (patch: Partial<SP>) => {
    const u = new URLSearchParams(Object.entries({ q: sp.q, role: roleId, status, sort: sort === "name" ? "" : sort, page: "", ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${u.toString()}`;
  };
  const active = !!(q || roleId || status);

  return (
    <>
      <PageHeader
        title="Staff"
        sub={<>Staff sign in on their phone with store code <strong className="font-mono font-semibold text-zinc-900">{store.joinCode}</strong> and their own PIN.</>}
        actions={
          manage ? (
            <>
              {hasFeature(store.features, "csvImport") && <Link href={`/s/${storeId}/staff/import`} className="btn-secondary"><Icon name="plus" className="size-4" />Import</Link>}
              <a href="#add" className="btn-primary"><Icon name="plus" className="size-4" />Add person</a>
            </>
          ) : undefined
        }
      />

      {/* search + filters: a plain GET form, so results are linkable and work without JS */}
      <form className="card mb-4 grid gap-3 p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_200px_220px_150px_auto]" role="search">
        <div className="relative">
          <Icon name="users" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input name="q" defaultValue={sp.q} placeholder="Search name, email or role" className="input pl-9" aria-label="Search staff" />
        </div>
        <select name="role" defaultValue={roleId} className="input" aria-label="Filter by role">
          <option value="">All roles</option>
          {(Object.keys(ROLE_CATEGORIES) as RoleCategory[]).map((c) => (
            <optgroup key={c} label={ROLE_CATEGORIES[c].label}>
              {roles.filter((r) => r.category === c).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select name="status" defaultValue={status} className="input" aria-label="Filter by status">
          <option value="">Any status</option>
          {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => <option key={k} value={k}>{STATUS_FILTERS[k]}</option>)}
        </select>
        <select name="sort" defaultValue={sort} className="input" aria-label="Sort">
          <option value="name">Sort: name</option>
          <option value="hours">Sort: contract hours</option>
          <option value="start">Sort: start date</option>
        </select>
        <div className="flex gap-2">
          <button className="btn-primary flex-1">Search</button>
          {active && <Link href="?" className="btn-ghost">Clear</Link>}
        </div>
      </form>

      <p className="mb-2 text-sm text-zinc-500">
        {filtered.length === employees.length ? `${employees.length} people` : `${filtered.length} of ${employees.length} people`}
        {pages > 1 && ` · page ${page} of ${pages}`}
      </p>

      <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
        {shown.map((e) => {
          const days = tenure(e.startDate);
          const i = info(e.id);
          return (
            <Link key={e.id} href={`/s/${storeId}/staff/${e.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-zinc-50 sm:px-6">
              <Avatar name={e.name} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{e.name}</span>
                  {days < 90 && <Badge tone="blue">New · {days}d</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {roles.filter((r) => (e.roleIds ?? []).includes(r.id)).map((r) => <RoleChip key={r.id} role={r} />)}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{e.contractedHours}h contract · {e.maxHoursPerWeek}h max</div>
              </div>
              <div className="hidden flex-col items-end gap-1 sm:flex">
                {!i.usual ? <Badge tone="red">No availability</Badge> : i.temp ? <Badge tone="violet">{i.temp.note || "Temporary"} pattern</Badge> : <Badge tone="green">Availability set</Badge>}
                {i.pending && <Badge tone="amber">Change to approve</Badge>}
                {flagsFor(e.id).length > 0 && <Badge tone={flagsFor(e.id).some((f) => f.severity === "error") ? "red" : "amber"} icon="alert">{flagsFor(e.id).length} compliance</Badge>}
              </div>
              <Icon name="right" className="size-4 text-zinc-300" />
            </Link>
          );
        })}
        {!shown.length && <p className="p-6 text-sm text-zinc-500">{employees.length ? "No one matches those filters." : "No staff yet. Add them below or import a spreadsheet."}</p>}
      </div>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Pages">
          {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="btn-secondary"><Icon name="left" className="size-4" />Previous</Link> : <span />}
          <div className="hidden gap-1 sm:flex">
            {Array.from({ length: pages }, (_, n) => n + 1).map((n) => (
              <Link key={n} href={qs({ page: String(n) })} className={`grid size-9 place-items-center rounded-md text-sm font-medium ${n === page ? "bg-brand-600 text-white" : "text-zinc-600 hover:bg-zinc-100"}`}>{n}</Link>
            ))}
          </div>
          {page < pages ? <Link href={qs({ page: String(page + 1) })} className="btn-secondary">Next<Icon name="right" className="size-4" /></Link> : <span />}
        </nav>
      )}

      {manage && (
        <div id="add" className="scroll-mt-24">
          <Section title="Add a member of staff" className="mt-6">
            <EmployeeForm action={addEmployee.bind(null, storeId)} submit="Add to team" roles={roleOptions(roles)} canGrantAccess={can(access, "account.admin")} />
          </Section>
        </div>
      )}
    </>
  );
}
