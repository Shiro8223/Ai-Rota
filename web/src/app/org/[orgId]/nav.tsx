"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";

export interface OrgLink { href: string; label: string; icon: IconName }

const isOn = (path: string, href: string, home: string) => (href === home ? path === home : path.startsWith(href));

/** Desktop: tabs under the header, like a site's. */
export function OrgTabs({ links, home }: { links: OrgLink[]; home: string }) {
  const path = usePathname();
  return (
    <nav className="hidden border-t border-zinc-100 md:block" aria-label="Group">
      <div className="mx-auto flex max-w-7xl items-center px-1">
        {links.map((l) => {
          const on = isOn(path, l.href, home);
          return (
            <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={`relative flex h-11 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition ${on ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}`}>
              <Icon name={l.icon} className="size-4" />
              {l.label}
              {on && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-sm bg-brand-600" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Phones: a hamburger that opens the group pages, the sites, and account bits (language,
 * sign out, passed in from the server as `extra`). Closes on navigation, Escape or a tap outside.
 */
export function OrgMenu({ links, home, sites, who, extra }: { links: OrgLink[]; home: string; sites: { id: string; name: string }[]; who: string; extra: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <div ref={ref} className="md:hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="org-menu" aria-label={open ? "Close menu" : "Open menu"} className="grid size-10 place-items-center rounded-md text-zinc-700 hover:bg-zinc-100">
        <Icon name={open ? "x" : "menu"} className="size-6" />
      </button>
      {open && (
        <>
          <div className="fixed inset-x-0 top-14 bottom-0 z-30 bg-zinc-900/20" aria-hidden />
          <div id="org-menu" className="fixed inset-x-0 top-14 z-40 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-zinc-200 bg-white px-4 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-lg">
            <nav aria-label="Group" className="grid gap-1">
              {links.map((l) => {
                const on = isOn(path, l.href, home);
                return (
                  <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined} className={`flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] font-medium ${on ? "bg-brand-50 text-brand-800" : "text-zinc-700 hover:bg-zinc-50"}`}>
                    <Icon name={l.icon} className={`size-5 ${on ? "text-brand-600" : "text-zinc-400"}`} />
                    {l.label}
                  </Link>
                );
              })}
            </nav>
            {sites.length > 0 && (
              <>
                <p className="eyebrow mt-4 mb-1 px-3">Sites</p>
                <div className="grid gap-1">
                  {sites.map((s) => (
                    <Link key={s.id} href={`/s/${s.id}/rota`} className="flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] text-zinc-700 hover:bg-zinc-50">
                      <span className="grid size-7 place-items-center rounded-md bg-teal-50 text-teal-700"><Icon name="calendar" className="size-4" /></span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <Icon name="right" className="size-4 text-zinc-300" />
                    </Link>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4 border-t border-zinc-100 pt-3">
              <p className="mb-2 truncate px-3 text-xs text-zinc-500">Signed in as {who}</p>
              {extra}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
