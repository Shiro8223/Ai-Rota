import "server-only";
import { cookies, headers } from "next/headers";
import { dict, fromAcceptLanguage, isLang, type Lang } from "./i18n";

export const LANG_COOKIE = "lang";

/** The visitor's language: their saved choice, else their browser's language, else English. */
export async function getLang(): Promise<Lang> {
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(saved)) return saved;
  return fromAcceptLanguage((await headers()).get("accept-language"));
}

export async function getDict() {
  const lang = await getLang();
  return { lang, t: dict(lang) };
}
