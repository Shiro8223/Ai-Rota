"use client";

import { useTransition } from "react";
import { setLanguage } from "@/app/lang-actions";
import { LANG_KEYS, LANGS, type Lang } from "@/lib/i18n";

/** Language switcher: remembered on this device. */
export function LanguagePicker({ lang, label, tone = "light", full = false }: { lang: Lang; label: string; tone?: "light" | "dark"; full?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={label}
      title={label}
      value={lang}
      disabled={pending}
      onChange={(e) => start(() => setLanguage(e.target.value))}
      className={`h-9 ${full ? "w-full" : ""} cursor-pointer rounded-md border px-2 text-sm ${tone === "dark" ? "border-white/20 bg-white/10 text-white [&>option]:text-zinc-900" : "border-zinc-200 bg-white text-zinc-700"}`}
    >
      {LANG_KEYS.map((k) => <option key={k} value={k}>{LANGS[k].label}</option>)}
    </select>
  );
}
