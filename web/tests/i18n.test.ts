import { describe, expect, it } from "vitest";
import { dict, fill, fromAcceptLanguage, LANG_KEYS } from "@/lib/i18n";

describe("translations", () => {
  const en = dict("en");
  for (const lang of LANG_KEYS.filter((l) => l !== "en")) {
    it(`${lang} translates every key and keeps every placeholder`, () => {
      const t = dict(lang);
      const untranslated = (Object.keys(en) as (keyof typeof en)[]).filter((k) => t[k] === en[k] && !/^(Demo|Contract|Admin|Manager|Staff)$/.test(en[k]) && !en[k].startsWith("{"));
      // A handful of words are genuinely the same in some languages (e.g. "Contract" -> "Contract" in Romanian).
      expect(untranslated.length, `${lang}: ${untranslated.join(", ")}`).toBeLessThanOrEqual(4);
      for (const k of Object.keys(en) as (keyof typeof en)[]) {
        const want = (en[k].match(/\{\w+\}/g) ?? []).sort();
        expect((t[k].match(/\{\w+\}/g) ?? []).sort(), `${lang}.${k}`).toEqual(want);
      }
    });
  }
  it("picks a language from the browser", () => {
    expect(fromAcceptLanguage("pl-PL,pl;q=0.9,en;q=0.8")).toBe("pl");
    expect(fromAcceptLanguage("de-DE,de;q=0.9")).toBe("en");
    expect(fromAcceptLanguage(undefined)).toBe("en");
  });
  it("fills placeholders", () => {
    expect(fill(dict("es").hi, { name: "Ana" })).toBe("Hola, Ana");
  });
});
