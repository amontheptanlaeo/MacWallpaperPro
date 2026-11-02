// Website localization. Translations live in public/i18n/<code>.json (also served statically) and are
// bundled into the Worker so pages render in the right language with zero extra requests.
import ar from "../../public/i18n/ar.json";
import de from "../../public/i18n/de.json";
import en from "../../public/i18n/en.json";
import es from "../../public/i18n/es.json";
import fr from "../../public/i18n/fr.json";
import hi from "../../public/i18n/hi.json";
import id from "../../public/i18n/id.json";
import it from "../../public/i18n/it.json";
import ja from "../../public/i18n/ja.json";
import ko from "../../public/i18n/ko.json";
import ptBR from "../../public/i18n/pt-BR.json";
import ru from "../../public/i18n/ru.json";
import th from "../../public/i18n/th.json";
import tr from "../../public/i18n/tr.json";
import vi from "../../public/i18n/vi.json";
import zhHans from "../../public/i18n/zh-Hans.json";
import zhHant from "../../public/i18n/zh-Hant.json";

export type Dict = Record<string, string>;
export type Key = keyof typeof en;

export interface Language {
  code: string;
  name: string; // native name
  flag: string;
  dir: "ltr" | "rtl";
  dict: Dict;
}

// Same set and order as the macOS app.
export const LANGUAGES: Language[] = [
  { code: "en", name: "English", flag: "🇺🇸", dir: "ltr", dict: en },
  { code: "th", name: "ไทย", flag: "🇹🇭", dir: "ltr", dict: th },
  { code: "zh-Hans", name: "简体中文", flag: "🇨🇳", dir: "ltr", dict: zhHans },
  { code: "zh-Hant", name: "繁體中文", flag: "🇹🇼", dir: "ltr", dict: zhHant },
  { code: "ja", name: "日本語", flag: "🇯🇵", dir: "ltr", dict: ja },
  { code: "ko", name: "한국어", flag: "🇰🇷", dir: "ltr", dict: ko },
  { code: "es", name: "Español", flag: "🇪🇸", dir: "ltr", dict: es },
  { code: "fr", name: "Français", flag: "🇫🇷", dir: "ltr", dict: fr },
  { code: "de", name: "Deutsch", flag: "🇩🇪", dir: "ltr", dict: de },
  { code: "it", name: "Italiano", flag: "🇮🇹", dir: "ltr", dict: it },
  { code: "pt-BR", name: "Português (Brasil)", flag: "🇧🇷", dir: "ltr", dict: ptBR },
  { code: "ru", name: "Русский", flag: "🇷🇺", dir: "ltr", dict: ru },
  { code: "tr", name: "Türkçe", flag: "🇹🇷", dir: "ltr", dict: tr },
  { code: "id", name: "Bahasa Indonesia", flag: "🇮🇩", dir: "ltr", dict: id },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳", dir: "ltr", dict: vi },
  { code: "hi", name: "हिन्दी", flag: "🇮🇳", dir: "ltr", dict: hi },
  { code: "ar", name: "العربية", flag: "🇸🇦", dir: "rtl", dict: ar },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));
export const DEFAULT_LANG = LANGUAGES[0];
export const LANG_COOKIE = "mwp_lang";

/** Map any BCP 47 tag to one of our 17 languages (or null). */
export function matchLanguage(tag: string): Language | null {
  const t = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!t) return null;
  const exact = BY_CODE.get(t);
  if (exact) return exact;
  const [primary, ...rest] = t.split("-");
  if (primary === "zh") {
    const traditional = rest.some((p) => p === "hant" || p === "tw" || p === "hk" || p === "mo");
    return BY_CODE.get(traditional ? "zh-hant" : "zh-hans")!;
  }
  if (primary === "pt") return BY_CODE.get("pt-br")!;
  if (primary === "in") return BY_CODE.get("id")!; // legacy Indonesian tag
  return BY_CODE.get(primary) ?? null;
}

/** Parse Accept-Language with q-values and return the best supported language. */
export function fromAcceptLanguage(header: string | null): Language | null {
  if (!header) return null;
  const items = header
    .split(",")
    .slice(0, 20)
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)).find(Boolean);
      return { tag, q: q ? Number(q[1]) : 1, i };
    })
    .filter((x) => x.tag && x.tag !== "*" && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const it of items) {
    const l = matchLanguage(it.tag);
    if (l) return l;
  }
  return null;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Priority: ?hl= (shareable links) > cookie (switcher) > Accept-Language > English. */
export function pickLanguage(request: Request): Language {
  const url = new URL(request.url);
  const hl = url.searchParams.get("hl");
  return (
    (hl && matchLanguage(hl)) ||
    matchLanguage(readCookie(request, LANG_COOKIE) || "") ||
    fromAcceptLanguage(request.headers.get("Accept-Language")) ||
    DEFAULT_LANG
  );
}

export function languageByCode(code: string): Language | null {
  return BY_CODE.get(code.toLowerCase()) ?? null;
}

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function translator(lang: Language): T {
  return (key, vars) => {
    let s = lang.dict[key] ?? (en as Dict)[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  };
}

/** Keys the browser scripts need (cards, modals, upload errors…), embedded as JSON in each page. */
const CLIENT_PREFIXES = ["card.", "install.", "err.", "browse.", "up.", "mine.", "admin.", "scan.", "cat.", "detail.", "consent.", "nav."];
export function clientDict(lang: Language): Dict {
  const out: Dict = {};
  for (const k of Object.keys(en)) {
    if (CLIENT_PREFIXES.some((p) => k.startsWith(p))) out[k] = lang.dict[k] ?? (en as Dict)[k];
  }
  return out;
}

export const ALL_DICTS = LANGUAGES.map((l) => ({ code: l.code, dict: l.dict as Dict }));
export const EN = en as Dict;
