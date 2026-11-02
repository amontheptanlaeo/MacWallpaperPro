// Admin statistics page (/community/admin/stats). Server-rendered: no client script, no chart
// library; the chart is inline SVG styled by site.css classes (the strict CSP allows no inline style).
import { escapeHtml as e } from "../lib/http";
import { STAT_RANGES, type GithubCounts, type StatEvent, type StatsReport } from "../lib/stats";
import { fmtDate } from "./components";
import { page, type Ctx } from "./layout";

const SERIES: { event: StatEvent; key: string; cls: string }[] = [
  { event: "app_download", key: "stats.appDownloads", cls: "app" },
  { event: "wallpaper_install", key: "stats.installs", cls: "inst" },
  { event: "page_view", key: "stats.pageViews", cls: "view" },
];

function num(ctx: Ctx, n: number): string {
  try {
    return new Intl.NumberFormat(ctx.lang.code).format(n);
  } catch {
    return String(n);
  }
}

/** Regional-indicator flag for a two-letter code; a neutral globe for unknown / Tor. */
export function flag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === "XX") return "\u{1F310}";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(ctx: Ctx, code: string): string {
  if (code === "XX") return ctx.t("stats.unknownCountry");
  if (code === "T1") return "Tor";
  try {
    return new Intl.DisplayNames([ctx.lang.code, "en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

function refLabel(ctx: Ctx, ref: string): string {
  if (ref === "(direct)") return ctx.t("stats.direct");
  if (ref === "(internal)") return ctx.t("stats.internal");
  if (ref === "(other)") return ctx.t("stats.other");
  return ref;
}

function chart(ctx: Ctx, r: StatsReport): string {
  const { t } = ctx;
  const W = 720, H = 240, L = 44, R = 12, T = 12, B = 28;
  const max = Math.max(1, ...r.daily.flatMap((d) => SERIES.map((s) => d[s.event])));
  const n = r.daily.length;
  const x = (i: number) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const lines = SERIES.map(
    (s) => `<polyline class="chart__line chart__line--${s.cls}" points="${r.daily.map((d, i) => `${x(i).toFixed(1)},${y(d[s.event]).toFixed(1)}`).join(" ")}"/>`,
  ).join("");
  const ticks = [0, Math.floor((n - 1) / 2), n - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text class="chart__tick" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${e(fmtDate(ctx, r.daily[i].day + "T00:00:00Z"))}</text>`)
    .join("");
  const desc = t("stats.chartLabel", { from: fmtDate(ctx, r.from + "T00:00:00Z"), to: fmtDate(ctx, r.to + "T00:00:00Z") });
  return `<figure class="chart">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-t">
    <title id="chart-t">${e(desc)}</title>
    <line class="chart__grid" x1="${L}" x2="${W - R}" y1="${y(max)}" y2="${y(max)}"/>
    <line class="chart__grid" x1="${L}" x2="${W - R}" y1="${y(max / 2)}" y2="${y(max / 2)}"/>
    <line class="chart__axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    <text class="chart__tick" x="${L - 6}" y="${y(max) + 4}" text-anchor="end">${e(num(ctx, max))}</text>
    <text class="chart__tick" x="${L - 6}" y="${y(0) + 4}" text-anchor="end">0</text>
    ${lines}${ticks}
  </svg>
  <figcaption class="chart__legend">${SERIES.map((s) => `<span><i class="chart__key chart__key--${s.cls}" aria-hidden="true"></i>${e(t(s.key as never))}</span>`).join("")}</figcaption>
</figure>
<details class="stats__raw"><summary>${e(t("stats.dailyTable"))}</summary>
${table(
  ctx,
  t("stats.day"),
  r.daily.slice().reverse().map((d) => ({ label: fmtDate(ctx, d.day + "T00:00:00Z"), app_download: d.app_download, wallpaper_install: d.wallpaper_install, page_view: d.page_view })),
)}</details>`;
}

type Row = { label: string; lead?: string } & Record<StatEvent, number>;

function table(ctx: Ctx, head: string, rows: Row[]): string {
  const { t } = ctx;
  if (!rows.length) return `<p class="muted">${e(t("stats.empty"))}</p>`;
  return `<div class="stats__scroll"><table class="stats__table">
  <thead><tr><th scope="col">${e(head)}</th>${SERIES.map((s) => `<th scope="col" class="num">${e(t(s.key as never))}</th>`).join("")}</tr></thead>
  <tbody>${rows
    .map(
      (r) => `<tr><th scope="row" dir="auto">${r.lead ? `<span class="stats__flag" aria-hidden="true">${r.lead}</span>` : ""}${e(r.label)}</th>${SERIES.map((s) => `<td class="num">${e(num(ctx, r[s.event]))}</td>`).join("")}</tr>`,
    )
    .join("")}</tbody>
</table></div>`;
}

export function statsPage(ctx: Ctx, r: StatsReport, gh: GithubCounts | null): Response {
  const { t } = ctx;
  const range = `<nav class="chips" aria-label="${e(t("stats.range"))}">${STAT_RANGES.map(
    (d) => `<a class="chip" href="/community/admin/stats?days=${d}"${d === r.days ? ' aria-current="true"' : ""}>${e(t("stats.days", { n: d }))}</a>`,
  ).join("")}</nav>`;
  const totals = `<dl class="facts stats__totals">
  ${SERIES.map((s) => `<div><dt>${e(t(s.key as never))}</dt><dd>${e(num(ctx, r.totals[s.event]))}</dd></div>`).join("")}
  <div><dt>${e(t("stats.github"))}</dt><dd>${gh ? e(num(ctx, gh.total)) : "–"}</dd></div>
</dl>
<p class="muted">${
    gh
      ? gh.latest
        ? e(t("stats.githubLatest", { tag: gh.latest.tag, n: num(ctx, gh.latest.downloads) }))
        : ""
      : e(t("stats.githubUnavailable"))
  } ${e(t("stats.githubNote"))}</p>`;
  const countries = table(
    ctx,
    t("stats.country"),
    r.countries.map((c) => ({ ...c, label: countryName(ctx, c.country), lead: flag(c.country) })),
  );
  const refs = table(ctx, t("stats.referrer"), r.referrers.map((c) => ({ ...c, label: refLabel(ctx, c.ref) })));
  const utm = table(ctx, t("stats.source"), r.utm.map((c) => ({ ...c, label: c.utm })));
  const wps = r.wallpapers.length
    ? `<ol class="stats__list">${r.wallpapers
        .map(
          (w) =>
            `<li><a href="/community/w/${e(w.id)}" dir="auto">${e(w.title ?? w.id)}</a><span class="num">${e(num(ctx, w.installs))}</span></li>`,
        )
        .join("")}</ol>`
    : `<p class="muted">${e(t("stats.empty"))}</p>`;
  const body = `<section class="pagehead wrap"><div class="pagehead__glow" aria-hidden="true"></div>
  <h1 class="h1">${e(t("stats.title"))}</h1><p class="lede">${e(t("stats.lede"))}</p>
  <p><a class="btn btn--glass btn--sm" href="/community/admin">${e(t("stats.back"))}</a></p>
</section>
<div class="wrap stats">
  ${range}
  <section aria-labelledby="st-tot"><h2 class="h3" id="st-tot">${e(t("stats.total"))}</h2>${totals}</section>
  <section aria-labelledby="st-day"><h2 class="h3" id="st-day">${e(t("stats.daily"))}</h2>${chart(ctx, r)}</section>
  <section aria-labelledby="st-c"><h2 class="h3" id="st-c">${e(t("stats.countries"))}</h2>${countries}</section>
  <div class="stats__two">
    <section aria-labelledby="st-r"><h2 class="h3" id="st-r">${e(t("stats.referrers"))}</h2>${refs}</section>
    <section aria-labelledby="st-u"><h2 class="h3" id="st-u">${e(t("stats.utm"))}</h2>${utm}</section>
  </div>
  <section aria-labelledby="st-w"><h2 class="h3" id="st-w">${e(t("stats.wallpapers"))}</h2>${wps}</section>
</div>`;
  return page(ctx, { title: t("stats.title"), path: "/community/admin/stats", noindex: true, body });
}
