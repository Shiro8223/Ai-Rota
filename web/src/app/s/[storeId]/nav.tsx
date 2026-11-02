"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";
import { NAV, type NavSeg } from "@/lib/nav";



function useActive(storeId: string) {
  const path = usePathname();
  return (seg: string) => path.startsWith(`/s/${storeId}/${seg}`) || (seg === "approvals" && path.startsWith(`/s/${storeId}/swaps`)) || (seg === "more" && path.startsWith(`/s/${storeId}/more`));
}

/** Setup pages sit apart from the day-to-day ones, on the right. */
const SETUP: NavSeg[] = ["setup", "admin", "settings"];

/** Desktop: one row of tabs under the header. Day-to-day on the left, setup on the right. */
export function TopNav({ storeId, pending, allowed, labels }: { storeId: string; pending: number; allowed: NavSeg[]; labels: Record<string, string> }) {
  const on = useActive(storeId);
  const items = NAV.filter((l) => allowed.includes(l.seg));
  const tab = (l: (typeof NAV)[number], compact: boolean) => (
    <Link
      key={l.seg}
      href={`/s/${storeId}/${l.seg}`}
      title={labels[l.seg] ?? l.label}
      aria-current={on(l.seg) ? "page" : undefined}
      className={`relative flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition ${on(l.seg) ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}
    >
      <Icon name={l.icon} className="size-4" />
      <span className={compact ? "hidden xl:inline" : ""}>{labels[l.seg] ?? l.label}</span>
      {l.seg === "approvals" && pending > 0 && <span className="rounded-md bg-amber-500 px-1.5 text-[11px] leading-[18px] font-semibold text-white">{pending}</span>}
      {on(l.seg) && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-sm bg-brand-600" />}
    </Link>
  );
  const main = items.filter((l) => !SETUP.includes(l.seg));
  const setup = items.filter((l) => SETUP.includes(l.seg));
  return (
    <nav className="no-print hidden border-t border-zinc-100 md:block" aria-label="Sections">
      <div className="mx-auto flex max-w-7xl items-center px-1">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">{main.map((l) => tab(l, false))}</div>
        {setup.length > 0 && (
          <div className="ml-2 flex shrink-0 items-center border-l border-zinc-200 pl-1">{setup.map((l) => tab(l, true))}</div>
        )}
      </div>
    </nav>
  );
}

/** Signed-in person, language and sign out, tucked into one menu. */
export function AccountMenu({ name, sub, children }: { name: string; sub?: string; children: React.ReactNode }) {
  // "Alex Morgan" -> AM; an email login -> its first letter.
  const initials = name.includes("@") ? name[0]!.toUpperCase() : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="group relative">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md pr-1.5 pl-1 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden" aria-label="Account">
        <span className="grid size-7 place-items-center rounded-md bg-zinc-900 text-[11px] font-semibold text-white">{initials || "?"}</span>
        <Icon name="right" className="size-3.5 rotate-90 text-zinc-400 transition group-open:-rotate-90" />
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
        <div className="px-2 pt-1 pb-2">
          <p className="truncate text-sm font-medium">{name}</p>
          {sub && <p className="truncate text-xs text-zinc-500">{sub}</p>}
        </div>
        <div className="border-t border-zinc-100 pt-2">{children}</div>
      </div>
    </details>
  );
}

/** Phones: up to five tabs; anything beyond four goes under "More". */
export function BottomNav({ storeId, pending, allowed, labels }: { storeId: string; pending: number; allowed: NavSeg[]; labels: Record<string, string> }) {
  const on = useActive(storeId);
  const items = NAV.filter((l) => allowed.includes(l.seg));
  const shown: { seg: string; label: string; icon: IconName }[] = items.length <= 5 ? items : [...items.slice(0, 4), { seg: "more", label: "More", icon: "bars" }];
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((l) => (
          <Link key={l.seg} href={`/s/${storeId}/${l.seg}`} className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${on(l.seg) ? "text-brand-700" : "text-zinc-500"}`}>
            <Icon name={l.icon} className="size-[22px]" />
            {labels[l.seg] ?? l.label}
            {l.seg === "approvals" && pending > 0 && (
              <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 rounded-md bg-amber-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">{pending}</span>
            )}
          </Link>
        ))}
      </div>
    </nav>
  );
}
