import Link from "next/link";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { getDict } from "@/lib/lang";
import { Avatar } from "@/components/ui";
import { db, isDemo } from "@/lib/db";
import { DEMO_STORE_ID, demoPin } from "@/lib/seed";
import { demoManagerLogin, demoStaffLogin } from "./actions";
import { ManagerEmailForm, StaffForm } from "./forms";

export const dynamic = "force-dynamic";

const POINTS = [
  { icon: "sparkles", title: "Rules in plain English", text: "“Never put two new starters on closing.” Confirmed once, applied every week." },
  { icon: "wand", title: "A fair rota in seconds", text: "Hours, closes and weekends shared out fairly, with legal rest built in." },
  { icon: "swap", title: "Swaps that can't break rules", text: "Staff swap on their phones. Every swap is checked, and you approve it." },
] as const;

export default async function LoginPage() {
  const { lang, t } = await getDict();
  const demo = isDemo();
  const staff = demo ? await (await db()).list("employees", { storeId: DEMO_STORE_ID, active: true }) : [];
  const store = demo ? await (await db()).get("stores", DEMO_STORE_ID) : null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative overflow-hidden bg-brand-900 px-6 py-10 text-white sm:px-10 lg:flex lg:flex-col lg:justify-between lg:py-14">
        <div className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-brand-500/30 blur-3xl" />
        <div className="relative flex items-center justify-between gap-2.5">
          <span className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-white/15"><Icon name="calendar" className="size-5" /></span>
            <span className="text-lg font-semibold">Rota Agent</span>
          </span>
          <LanguagePicker lang={lang} label={t.language} tone="dark" />
        </div>
        <div className="relative mt-10 max-w-md lg:mt-0">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{t.tagline}</h1>
          <ul className="mt-8 hidden space-y-5 sm:block">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10"><Icon name={p.icon} className="size-4" /></span>
                <div>
                  <p className="font-medium">{p.title}</p>
                  <p className="text-sm text-white/65">{p.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 hidden text-xs text-white/50 lg:block">Built for UK restaurants · Working Time Regulations checked on every rota</p>
      </aside>

      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 lg:flex lg:flex-col lg:justify-center lg:py-14">
        {demo && (
          <section className="card mb-6 border-brand-200 bg-gradient-to-br from-brand-50 to-white">
            <p className="eyebrow text-brand-700">Demo</p>
            <h2 className="mt-1 text-lg font-semibold">{store?.name ?? "Test Wings, Leeds"}</h2>
            <p className="mt-1 text-sm text-zinc-600">15 staff with roles, 6 rules, this week published, plus a swap and a student request waiting. Nothing is emailed. Reset it from Settings.</p>
            <form action={demoManagerLogin} className="mt-4">
              <button className="btn-primary w-full">Enter as manager <Icon name="right" className="size-4" /></button>
            </form>
            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-sm font-medium text-brand-700">
                Or see the staff phone view <Icon name="right" className="size-4 transition group-open:rotate-90" />
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {staff.map((e) => (
                  <form key={e.id} action={demoStaffLogin.bind(null, e.id)}>
                    <button className="flex w-full items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-left hover:border-brand-500">
                      <Avatar name={e.name} size="sm" />
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-sm font-medium">{e.name.split(" ")[0]}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{e.role}</span>
                      </span>
                    </button>
                  </form>
                ))}
              </div>
              <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-center text-xs text-violet-900">Try <b>Priya</b> or <b>Alex</b>: Shift Leads, so their phone app has limited <b>Manager tools</b>.</p>
              <p className="mt-3 text-center text-xs text-zinc-500">Or sign in below as staff: code <code className="font-semibold">{store?.joinCode}</code>, PINs {demoPin(0)}–{demoPin(staff.length - 1)} in list order.</p>
            </details>
          </section>
        )}

        <section className="card">
          <h2 className="text-lg font-semibold">{t.managers}</h2>
          <p className="mb-5 text-sm text-zinc-500">{t.managersSub}</p>
          <ManagerEmailForm labels={t} />
        </section>
        <section className="card mt-4">
          <h2 className="text-lg font-semibold">{t.staff}</h2>
          <p className="mb-5 text-sm text-zinc-500">{t.staffSub}</p>
          <StaffForm labels={t} />
        </section>
        <p className="mt-6 flex justify-center gap-4 text-xs text-zinc-400">
          <Link href="/legal/terms" className="hover:underline">Terms</Link>
          <Link href="/legal/privacy" className="hover:underline">Privacy</Link>
          <Link href="/legal/dpa" className="hover:underline">Data processing</Link>
        </p>
      </main>
    </div>
  );
}
