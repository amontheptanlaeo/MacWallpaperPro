import { describe, expect, it } from "vitest";
import { ALL_DICTS, EN, fromAcceptLanguage, LANGUAGES, matchLanguage } from "../src/lib/i18n";
import { call } from "./helpers";

const EXPECTED = ["en", "th", "zh-Hans", "zh-Hant", "ja", "ko", "es", "fr", "de", "it", "pt-BR", "ru", "tr", "id", "vi", "hi", "ar"];

describe("translations", () => {
  it("ships exactly the 17 app languages", () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(EXPECTED);
  });

  it("every language has every key, non-empty, with the same placeholders", () => {
    const keys = Object.keys(EN);
    for (const { code, dict } of ALL_DICTS) {
      const missing = keys.filter((k) => !(k in dict));
      const extra = Object.keys(dict).filter((k) => !(k in EN));
      expect(missing, `${code} missing`).toEqual([]);
      expect(extra, `${code} extra`).toEqual([]);
      for (const k of keys) {
        expect(String(dict[k]).trim(), `${code}:${k}`).not.toBe("");
        const ph = (EN[k].match(/\{\w+\}/g) || []).sort();
        expect((String(dict[k]).match(/\{\w+\}/g) || []).sort(), `${code}:${k} placeholders`).toEqual(ph);
      }
    }
  });

  it("maps browser language tags to supported languages", () => {
    expect(matchLanguage("zh-TW")!.code).toBe("zh-Hant");
    expect(matchLanguage("zh-HK")!.code).toBe("zh-Hant");
    expect(matchLanguage("zh-CN")!.code).toBe("zh-Hans");
    expect(matchLanguage("zh")!.code).toBe("zh-Hans");
    expect(matchLanguage("pt-PT")!.code).toBe("pt-BR");
    expect(matchLanguage("th-TH")!.code).toBe("th");
    expect(matchLanguage("xx")).toBeNull();
    expect(fromAcceptLanguage("nl-NL,nl;q=0.9,ja;q=0.8,en;q=0.5")!.code).toBe("ja");
    expect(fromAcceptLanguage("en;q=0.2, ar;q=0.9")!.code).toBe("ar");
  });
});

describe("localized pages", () => {
  it("defaults from Accept-Language and sets <html lang dir>", async () => {
    const th = await (await call("/", { headers: { "Accept-Language": "th-TH,th;q=0.9,en;q=0.8" } })).text();
    expect(th).toMatch(/<html lang="th" dir="ltr"/);
    const en = await (await call("/")).text();
    expect(en).toMatch(/<html lang="en" dir="ltr"/);
  });

  it("renders Arabic right-to-left", async () => {
    for (const path of ["/", "/community", "/privacy", "/signin"]) {
      const res = await call(path, { headers: { "Accept-Language": "ar" } });
      const html = await res.text();
      expect(html, path).toMatch(/<html lang="ar" dir="rtl"/);
      expect(res.headers.get("Content-Language")).toBe("ar");
    }
  });

  it("the switcher cookie beats Accept-Language, and /lang/<code> stores it", async () => {
    const res = await call("/lang/ja?next=%2Fcommunity");
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/community");
    const sc = res.headers.get("Set-Cookie")!;
    expect(sc).toMatch(/^mwp_lang=ja;/);
    const html = await (await call("/community", { cookie: "mwp_lang=ja", headers: { "Accept-Language": "de" } })).text();
    expect(html).toMatch(/<html lang="ja" dir="ltr"/);
    expect((await call("/lang/ja?next=%2F%2Fevil.example")).headers.get("Location")).toBe("/community/upload");
  });

  it("lists all 17 languages in the header switcher with flags and native names", async () => {
    const html = await (await call("/")).text();
    for (const l of LANGUAGES) expect(html).toContain(`href="/lang/${l.code}?next=`);
    expect(html).toContain("العربية");
    expect(html).toContain("🇹🇭");
  });
});
