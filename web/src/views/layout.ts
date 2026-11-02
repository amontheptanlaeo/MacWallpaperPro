import { adsenseMeta } from "../lib/ads";
import { adConfig, type AdConfig, type SlotName } from "../lib/ads";
import { escapeHtml as e, html } from "../lib/http";
import { clientDict, LANGUAGES, pickLanguage, readCookie, translator, type Language, type T } from "../lib/i18n";
import { GITHUB_LOGO, icon, LOGO } from "./icons";

export const REPO_URL = "https://github.com/amontheptanlaeo/MacWallpaperPro";
export const CONSENT_COOKIE = "mwp_consent";

export interface Ctx {
  request: Request;
  env: Env;
  url: URL;
  lang: Language;
  t: T;
  ads: AdConfig | null;
}

export function makeCtx(request: Request, env: Env): Ctx {
  const lang = pickLanguage(request);
  return { request, env, url: new URL(request.url), lang, t: translator(lang), ads: adConfig(env) };
}

export function siteUrl(ctx: Ctx): string {
  return String(ctx.env.SITE_URL || ctx.url.origin).replace(/\/+$/, "");
}

interface PageOpts {
  title: string; // already translated; "" = brand title only
  description?: string;
  path: string; // canonical path without query
  body: string;
  scripts?: string[];
  /** Ad slots this page renders. Ads CSP + loader are only emitted when one of them is configured. */
  adSlots?: SlotName[];
  status?: number;
  bodyClass?: string;
  ogImage?: string;
  noindex?: boolean;
  nav?: "home" | "community" | "upload" | "";
}

function langMenu(ctx: Ctx): string {
  const next = ctx.url.pathname + ctx.url.search.replace(/([?&])hl=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return `<details class="lang" data-lang-menu>
  <summary class="lang__btn" aria-label="${e(ctx.t("lang.change"))}">
    <span class="lang__flag" aria-hidden="true">${ctx.lang.flag}</span><span class="lang__name">${e(ctx.lang.name)}</span>${icon("chevron", "icon icon--sm")}
  </summary>
  <div class="lang__panel">
    <p class="lang__title" id="lang-title">${e(ctx.t("lang.label"))}</p>
    <ul class="lang__list" aria-labelledby="lang-title">
${LANGUAGES.map(
  (l) =>
    `      <li><a class="lang__opt" href="/lang/${l.code}?next=${encodeURIComponent(next)}" hreflang="${l.code}" lang="${l.code}" dir="${l.dir}"${
      l.code === ctx.lang.code ? ' aria-current="true"' : ""
    }><span aria-hidden="true">${l.flag}</span><span>${e(l.name)}</span>${l.code === ctx.lang.code ? icon("check", "icon icon--sm lang__tick") : ""}</a></li>`,
).join("\n")}
    </ul>
  </div>
</details>`;
}

function header(ctx: Ctx, nav: PageOpts["nav"]): string {
  const { t } = ctx;
  const cur = (n: string) => (nav === n ? ' aria-current="page"' : "");
  return `<header class="bar" data-bar>
  <div class="bar__inner">
    <a class="brand" href="/" aria-label="MacWallpaperPro, ${e(t("nav.home"))}">${LOGO}<span class="brand__name">MacWallpaperPro</span></a>
    <nav class="bar__nav" aria-label="${e(t("nav.menu"))}">
      <a href="/community"${cur("community")}>${e(t("nav.community"))}</a>
      <a href="/community/upload"${cur("upload")}>${e(t("nav.upload"))}</a>
      <a href="${REPO_URL}" rel="noopener">${e(t("nav.github"))}</a>
    </nav>
    <div class="bar__end">
      ${langMenu(ctx)}
      <div class="account" data-account hidden></div>
      <a class="btn btn--light btn--sm bar__cta" href="/download">${icon("download")}<span>${e(t("nav.download"))}</span></a>
      <details class="mnav" data-mnav>
        <summary class="iconbtn" aria-label="${e(t("nav.menu"))}">${icon("menu")}</summary>
        <div class="mnav__panel">
          <a href="/"${cur("home")}>${e(t("nav.home"))}</a>
          <a href="/community"${cur("community")}>${e(t("nav.community"))}</a>
          <a href="/community/upload"${cur("upload")}>${e(t("nav.upload"))}</a>
          <a href="${REPO_URL}" rel="noopener">${e(t("nav.github"))}</a>
          <a class="btn btn--light" href="/download">${icon("download")}<span>${e(t("hero.cta"))}</span></a>
        </div>
      </details>
    </div>
  </div>
</header>`;
}

function footer(ctx: Ctx, extra: string): string {
  const { t } = ctx;
  const consentLink = ctx.ads ? `<button type="button" class="linkbtn" data-consent-open>${e(t("foot.cookies"))}</button>` : "";
  return `${extra}
<footer class="foot">
  <div class="foot__inner">
    <div class="foot__brand">
      <a class="brand" href="/">${LOGO}<span class="brand__name">MacWallpaperPro</span></a>
      <p>${e(t("foot.tagline"))}</p>
    </div>
    <nav class="foot__links" aria-label="Footer">
      <a href="/community">${e(t("nav.community"))}</a>
      <a href="/community/upload">${e(t("nav.upload"))}</a>
      <a href="/download">${e(t("nav.download"))}</a>
      <a href="${REPO_URL}" rel="noopener">${GITHUB_LOGO}<span>${e(t("nav.github"))}</span></a>
      <a href="/privacy">${e(t("foot.privacy"))}</a>
      ${consentLink}
    </nav>
    <p class="foot__fine">${e(t("foot.license"))}. ${e(t("foot.trademark"))}</p>
  </div>
</footer>`;
}

function consentBanner(ctx: Ctx): string {
  if (!ctx.ads) return "";
  const decided = readCookie(ctx.request, CONSENT_COOKIE);
  const { t } = ctx;
  return `<div class="consent" data-consent role="region" aria-labelledby="consent-title"${decided === "granted" || decided === "denied" ? " hidden" : ""}>
  <div class="consent__text">
    <p class="consent__title" id="consent-title">${e(t("consent.title"))}</p>
    <p>${e(t("consent.body"))} <a href="/privacy">${e(t("consent.more"))}</a></p>
  </div>
  <div class="consent__actions">
    <button type="button" class="btn btn--ghost" data-consent-choice="denied">${e(t("consent.reject"))}</button>
    <button type="button" class="btn btn--light" data-consent-choice="granted">${e(t("consent.accept"))}</button>
  </div>
</div>`;
}

/** JSON in a non-executable script block; `<` is escaped so it can never close the tag. */
export function jsonBlock(id: string, data: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function page(ctx: Ctx, o: PageOpts, footerExtra = ""): Response {
  const { lang, t } = ctx;
  const base = siteUrl(ctx);
  const showsAds = !!ctx.ads && (o.adSlots ?? []).some((s) => ctx.ads!.slots[s]);
  const title = o.title ? `${o.title} | MacWallpaperPro` : t("meta.title");
  const desc = o.description ?? t("meta.description");
  const canonical = base + o.path;
  const og = o.ogImage ? (o.ogImage.startsWith("http") ? o.ogImage : base + o.ogImage) : `${base}/assets/og.jpg`;
  const alternates = LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${e(canonical)}?hl=${l.code}">`).join("\n");
  const scripts = ["/assets/js/site.js", ...(o.scripts ?? [])];
  const body = `<!doctype html>
<html lang="${lang.code}" dir="${lang.dir}" data-script="${scriptClass(lang.code)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<meta name="color-scheme" content="dark">
${adsenseMeta(ctx.env)}
<meta name="theme-color" content="#070814">
${o.noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${e(canonical)}">
${o.noindex ? "" : alternates + `\n<link rel="alternate" hreflang="x-default" href="${e(canonical)}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="MacWallpaperPro">
<meta property="og:title" content="${e(o.title || t("meta.title"))}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${e(canonical)}">
<meta property="og:image" content="${e(og)}">
<meta property="og:locale" content="${lang.code.replace("-", "_")}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
${showsAds ? `<meta name="mwp-adsense" content="${e(ctx.ads!.client)}">` : ""}
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
${showsAds ? '<script src="/assets/js/ads.js" defer></script>' : ""}
</head>
<body class="${o.bodyClass ?? ""}">
<a class="skip" href="#main">${e(t("skip"))}</a>
${header(ctx, o.nav ?? "")}
<main id="main" tabindex="-1">
${o.body}
</main>
${footer(ctx, footerExtra)}
${consentBanner(ctx)}
${jsonBlock("mwp-i18n", clientDict(lang))}
</body>
</html>`;
  return html(body, o.status ?? 200, { "Content-Language": lang.code }, { ads: showsAds });
}

function scriptClass(code: string): string {
  if (code === "th") return "thai";
  if (code === "ar") return "arabic";
  if (code === "hi") return "devanagari";
  if (code === "ja") return "ja";
  if (code === "ko") return "ko";
  if (code === "zh-Hans") return "zh-hans";
  if (code === "zh-Hant") return "zh-hant";
  return "latin";
}

export function errorPage(ctx: Ctx, status: number, title: string, body: string, cta: { href: string; label: string }): Response {
  return page(ctx, {
    title,
    path: ctx.url.pathname,
    status,
    noindex: true,
    body: `<section class="empty-hero">
  <div class="empty-hero__glow" aria-hidden="true"></div>
  <h1>${e(title)}</h1>
  <p class="lede">${e(body)}</p>
  <a class="btn btn--light" href="${e(cta.href)}">${e(cta.label)}</a>
</section>`,
  });
}
