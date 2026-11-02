import Link from "next/link";
import type { ReactNode } from "react";
import type { Issue } from "@/lib/types";
import { Icon, type IconName } from "./icons";

export function PageHeader({ title, sub, actions, eyebrow }: { title: string; sub?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {sub && <div className="mt-1.5 max-w-2xl text-[15px] text-zinc-600">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const tones = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/15",
  grey: "bg-zinc-100 text-zinc-700 ring-zinc-500/15",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/15",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
};
export function Badge({ tone = "grey", children, icon }: { tone?: keyof typeof tones; children: ReactNode; icon?: IconName }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}>
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </span>
  );
}

export function Notice({ tone = "blue", children, icon }: { tone?: "blue" | "amber" | "red" | "green"; children: ReactNode; icon?: IconName }) {
  const c = {
    blue: "border-sky-200/80 bg-sky-50 text-sky-950",
    amber: "border-amber-200/80 bg-amber-50 text-amber-950",
    red: "border-red-200/80 bg-red-50 text-red-950",
    green: "border-emerald-200/80 bg-emerald-50 text-emerald-950",
  }[tone];
  const i: IconName = icon ?? (tone === "green" ? "check" : tone === "blue" ? "sparkles" : "alert");
  return (
    <div className={`mb-5 flex gap-3 rounded-2xl border px-4 py-3 text-sm ${c}`}>
      <Icon name={i} className="mt-0.5 size-4 shrink-0 opacity-70" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function IssueList({ issues, empty = "No problems found." }: { issues: Issue[]; empty?: string }) {
  if (!issues.length)
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
        <span className="grid size-5 place-items-center rounded-full bg-emerald-100"><Icon name="check" className="size-3.5" /></span>
        {empty}
      </p>
    );
  return (
    <ul className="space-y-2 text-sm">
      {issues.map((i, n) => (
        <li key={n} className="flex gap-2.5">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${i.severity === "error" ? "bg-red-500" : i.severity === "warning" ? "bg-amber-400" : "bg-zinc-300"}`} />
          <span className={i.severity === "info" ? "text-zinc-500" : "text-zinc-800"}>
            {i.message}
            {i.legal && <span className="ml-1.5 rounded bg-red-100 px-1 py-px text-[10px] font-semibold tracking-wide text-red-700 uppercase">Legal</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children, href, cta, icon = "calendar" }: { title: string; children?: ReactNode; href?: string; cta?: string; icon?: IconName }) {
  return (
    <div className="card flex flex-col items-center py-10 text-center">
      <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon name={icon} /></span>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-zinc-600">{children}</div>}
      {href && cta && <Link href={href} className="btn-primary mt-5">{cta}</Link>}
    </div>
  );
}

/** Link-based segmented control (works without JS, good on phones). */
export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <div className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex rounded-xl bg-zinc-100 p-1">
        {items.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition ${active === t.key ? "bg-white text-zinc-900 shadow-[var(--shadow-card)]" : "text-zinc-600 hover:text-zinc-900"}`}
          >
            {t.label}
            {!!t.count && <span className="rounded-md bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{t.count}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

const AVATAR = ["bg-rose-100 text-rose-700", "bg-sky-100 text-sky-700", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-700", "bg-emerald-100 text-emerald-700", "bg-teal-100 text-teal-700"];
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const tone = AVATAR[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];
  const s = size === "sm" ? "size-7 text-[11px]" : size === "lg" ? "size-12 text-base" : "size-9 text-xs";
  return <span className={`grid shrink-0 place-items-center rounded-full font-semibold ${s} ${tone}`}>{initials}</span>;
}

export function Section({ title, sub, actions, children, className = "" }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {sub && <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
