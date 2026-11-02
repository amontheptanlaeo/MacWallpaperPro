import { adSlot, type SlotName } from "../lib/ads";
import { escapeHtml as e } from "../lib/http";
import { CATEGORIES } from "../lib/validate";
import type { WallpaperSummary } from "../lib/wallpapers";
import { icon } from "./icons";
import type { Ctx } from "./layout";

export function fmtCount(ctx: Ctx, n: number): string {
  try {
    return new Intl.NumberFormat(ctx.lang.code, { notation: "compact", maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}

export function fmtDate(ctx: Ctx, iso: string): string {
  try {
    return new Intl.DateTimeFormat(ctx.lang.code, { year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function catLabel(ctx: Ctx, id: string): string {
  return ctx.t(`cat.${id}` as never);
}

export function card(ctx: Ctx, w: WallpaperSummary, opts: { featured?: boolean; eager?: boolean } = {}): string {
  const { t } = ctx;
  return `<article class="card${opts.featured ? " card--featured" : ""}" data-card data-id="${e(w.id)}">
  <div class="card__media">
    <img src="${e(w.thumbUrl)}" alt="" width="1600" height="1000" ${opts.eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">
    <span class="card__live" aria-hidden="true"><span class="dot"></span>${e(t("card.previewing"))}</span>
  </div>
  <div class="card__body">
    <div class="card__text">
      <h3 class="card__title"><a class="card__link" href="/community/w/${e(w.id)}">${e(w.title)}</a></h3>
      <p class="card__meta"><span class="card__author">${e(t("card.by", { name: w.author.name }))}</span>${w.downloads > 0 ? `<span class="card__dl" title="${e(t("card.downloads"))}">${icon("download", "icon icon--xs")}<span class="sr">${e(t("card.downloads"))}: </span>${e(fmtCount(ctx, w.downloads))}</span>` : ""}</p>
    </div>
    <button type="button" class="btn btn--install" data-install="${e(w.id)}" data-title="${e(w.title)}">${icon("install")}<span>${e(t("card.install"))}</span></button>
  </div>
</article>`;
}

export function chips(ctx: Ctx, active: string, base = "/community", extra: URLSearchParams = new URLSearchParams()): string {
  const all = ["all", ...CATEGORIES];
  return `<nav class="chips" aria-label="${e(ctx.t("browse.categories"))}" data-chips>
${all
  .map((c) => {
    const p = new URLSearchParams(extra);
    if (c !== "all") p.set("category", c);
    else p.delete("category");
    const qs = p.toString();
    const label = c === "all" ? ctx.t("cat.all") : catLabel(ctx, c);
    return `  <a class="chip chip--${c}" href="${base}${qs ? "?" + qs : ""}" data-category="${c}"${active === c ? ' aria-current="true"' : ""}><span class="chip__dot" aria-hidden="true"></span>${e(label)}</a>`;
  })
  .join("\n")}
</nav>`;
}

export function ad(ctx: Ctx, name: SlotName): string {
  return adSlot(ctx.ads, name, ctx.t);
}
