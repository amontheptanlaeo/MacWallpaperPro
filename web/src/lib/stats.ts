// Anonymous, aggregated statistics (migrations/0003_stats.sql).
//
// Privacy: only aggregate counters are stored, keyed by (UTC day, event, wallpaper id, country,
// referrer host, utm_source). No IP, user agent, cookie or per-person row. The once-per-day dedupe
// for installs and app downloads uses a salted SHA-256 of the IP that is pruned after a day.
//
// Cost: every write is a single D1 batch (one round-trip) inside ctx.waitUntil, so responses never
// wait for it, plus at most one SHA-256 of a short string.
import { sha256Hex } from "./crypto";
import { clientIp, HttpError } from "./http";

export type StatEvent = "app_download" | "wallpaper_install" | "page_view";
export const STAT_EVENTS: StatEvent[] = ["app_download", "wallpaper_install", "page_view"];

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Two-letter country from Cloudflare (`T1` = Tor), or "XX" when unknown. */
export function countryOf(request: Request): string {
  const c = String((request as Request & { cf?: { country?: unknown } }).cf?.country ?? "").toUpperCase();
  return /^[A-Z][A-Z0-9]$/.test(c) ? c : "XX";
}

/**
 * Referrer host only (no path or query): lowercased, without "www." / "m." / "mobile.".
 * "(direct)" when there is none (apps, typed URLs), "(internal)" for this site itself.
 */
export function refHost(referer: string | null, selfHost: string): string {
  if (!referer) return "(direct)";
  let host: string;
  try {
    const u = new URL(referer);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "(other)";
    host = u.hostname.toLowerCase();
  } catch {
    return "(direct)";
  }
  if (host === selfHost.toLowerCase()) return "(internal)";
  host = host.replace(/^(?:www|m|mobile)\./, "").replace(/\.$/, "");
  if (!host || host.length > 64 || !/^[a-z0-9.-]+$/.test(host)) return "(other)";
  return host;
}

/** utm_source, lowercased, only [a-z0-9_-], at most 32 characters ("" when absent or empty). */
export function sanitizeUtm(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}

/**
 * Only real top-level page loads count as views: a GET navigation for a document, not a prefetch,
 * a HEAD, a fetch() call or an obvious crawler. (The User-Agent is read here, never stored.)
 */
export function isPageLoad(request: Request): boolean {
  if (request.method !== "GET") return false;
  const h = request.headers;
  if (h.get("Sec-Fetch-Dest") !== "document" || h.get("Sec-Fetch-Mode") !== "navigate") return false;
  if (h.get("Sec-Purpose") || h.get("Purpose") || h.get("X-Moz") === "prefetch") return false;
  if (/bot|crawl|spider|slurp|preview|headless/i.test(h.get("User-Agent") || "")) return false;
  return true;
}

/** Server-side salt: DOWNLOAD_SALT (optional secret), else derived from the signing key. */
function salt(env: Env): string {
  const e = env as Env & { DOWNLOAD_SALT?: string };
  return String(e.DOWNLOAD_SALT || "") || "sk:" + String(env.SIGNING_KEY_PKCS8 || "");
}

export async function dedupeKey(env: Env, ip: string, target: string, day = utcDay()): Promise<string> {
  return sha256Hex(`mwp-download-v1\n${salt(env)}\n${day}\n${ip}\n${target}`);
}

interface Dims {
  day: string;
  event: StatEvent;
  wallpaperId: string;
  country: string;
  ref: string;
  utm: string;
}

function dims(request: Request, event: StatEvent, wallpaperId = "", utm = ""): Dims {
  const url = new URL(request.url);
  return { day: utcDay(), event, wallpaperId, country: countryOf(request), ref: refHost(request.headers.get("Referer"), url.hostname), utm: sanitizeUtm(utm) };
}

const UPSERT_TAIL = `ON CONFLICT (day, event, wallpaper_id, country, ref, utm) DO UPDATE SET count = count + 1`;

function upsert(env: Env, d: Dims): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO stats_daily (day, event, wallpaper_id, country, ref, utm, count) VALUES (?, ?, ?, ?, ?, ?, 1) ${UPSERT_TAIL}`).bind(
    d.day,
    d.event,
    d.wallpaperId,
    d.country,
    d.ref,
    d.utm,
  );
}

/** Same upsert, but only when this is the visitor's first hit of the day for `key`. */
function upsertIfFirst(env: Env, d: Dims, key: string): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO stats_daily (day, event, wallpaper_id, country, ref, utm, count)
     SELECT ?, ?, ?, ?, ?, ?, 1 WHERE (SELECT hits FROM download_seen WHERE key = ?) = 1 ${UPSERT_TAIL}`,
  ).bind(d.day, d.event, d.wallpaperId, d.country, d.ref, d.utm, key);
}

function seen(env: Env, key: string, day: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO download_seen (key, day, hits) VALUES (?, ?, 1) ON CONFLICT (key) DO UPDATE SET hits = hits + 1",
  ).bind(key, day);
}

/** Prune old dedupe rows now and then (~1 in 64 requests, picked from the hash: no RNG needed). */
function maybePrune(env: Env, key: string): D1PreparedStatement[] {
  if (!/^0[0-3]/.test(key)) return [];
  return [env.DB.prepare("DELETE FROM download_seen WHERE day < ?").bind(utcDay(new Date(Date.now() - 86400_000)))];
}

const logFail = (e: unknown) => console.warn(JSON.stringify({ msg: "stats_failed", error: String(e).slice(0, 200) }));

/**
 * A wallpaper download by the app (or browser): +1 on `wallpapers.downloads` and the
 * `wallpaper_install` counter, at most once per IP, wallpaper and day. One D1 batch.
 */
export async function recordInstall(env: Env, request: Request, wallpaperId: string): Promise<void> {
  const d = dims(request, "wallpaper_install", wallpaperId);
  const key = await dedupeKey(env, clientIp(request), "w:" + wallpaperId, d.day);
  await env.DB.batch([
    seen(env, key, d.day),
    env.DB.prepare("UPDATE wallpapers SET downloads = downloads + 1 WHERE id = ? AND (SELECT hits FROM download_seen WHERE key = ?) = 1").bind(
      wallpaperId,
      key,
    ),
    upsertIfFirst(env, d, key),
    ...maybePrune(env, key),
  ]);
}

/** /download (the app installer), at most once per IP and day. One D1 batch. */
export async function recordAppDownload(env: Env, request: Request, utm: string): Promise<void> {
  const d = dims(request, "app_download", "", utm);
  const key = await dedupeKey(env, clientIp(request), "app", d.day);
  await env.DB.batch([seen(env, key, d.day), upsertIfFirst(env, d, key), ...maybePrune(env, key)]);
}

/** utm_source from the URL, or from a same-site referrer's URL (landing page → /download). */
export function utmFrom(request: Request): string {
  const url = new URL(request.url);
  const own = url.searchParams.get("utm_source");
  if (own) return own;
  try {
    const r = new URL(request.headers.get("Referer") || "");
    if (r.host === url.host) return r.searchParams.get("utm_source") || "";
  } catch {
    // no or bad referrer
  }
  return "";
}

/** Count a page view in the background (only real page loads). One D1 statement. */
export function trackPageView(ctx: ExecutionContext, env: Env, request: Request, wallpaperId = ""): void {
  if (!isPageLoad(request)) return;
  ctx.waitUntil(upsert(env, dims(request, "page_view", wallpaperId, utmFrom(request))).run().then(() => undefined, logFail));
}

export function background(ctx: ExecutionContext, p: Promise<unknown>): void {
  ctx.waitUntil(p.then(() => undefined, logFail));
}

// ---------------------------------------------------------------------------
// Reading (admin only)
// ---------------------------------------------------------------------------
export const STAT_RANGES = [7, 30, 90] as const;

/** `days` for the stats views: 7, 30 or 90 (default 30). */
export function parseDays(raw: string | null): number {
  if (raw === null || raw === "") return 30;
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!(STAT_RANGES as readonly number[]).includes(n)) throw new HttpError(400, "invalid_days", "days must be 7, 30 or 90.");
  return n;
}


type Counts = Record<StatEvent, number>;
const zero = (): Counts => ({ app_download: 0, wallpaper_install: 0, page_view: 0 });

export interface StatsReport {
  days: number;
  from: string;
  to: string;
  totals: Counts;
  daily: ({ day: string } & Counts)[];
  countries: ({ country: string; total: number } & Counts)[];
  referrers: ({ ref: string; total: number } & Counts)[];
  utm: ({ utm: string; total: number } & Counts)[];
  wallpapers: { id: string; title: string | null; installs: number }[];
}

function pivot<K extends string>(rows: { k: string; event: StatEvent; n: number }[], name: K, limit: number) {
  const m = new Map<string, Counts>();
  for (const r of rows) {
    const c = m.get(r.k) ?? zero();
    c[r.event] = (c[r.event] ?? 0) + r.n;
    m.set(r.k, c);
  }
  return [...m.entries()]
    .map(([k, c]) => ({ [name]: k, ...c, total: c.app_download + c.wallpaper_install + c.page_view }) as { [P in K]: string } & Counts & { total: number })
    .sort((a, b) => b.total - a.total || (a[name] < b[name] ? -1 : 1))
    .slice(0, limit);
}

export async function statsReport(env: Env, days: number, now = new Date()): Promise<StatsReport> {
  const to = utcDay(now);
  const from = utcDay(new Date(now.getTime() - (days - 1) * 86400_000));
  const q = (sql: string) => env.DB.prepare(sql).bind(from, to);
  const range = "FROM stats_daily WHERE day >= ? AND day <= ?";
  type R = { k: string; event: StatEvent; n: number };
  const [daily, countries, refs, utm, wps] = await env.DB.batch<R & { title?: string | null }>([
    q(`SELECT day AS k, event, SUM(count) AS n ${range} GROUP BY day, event`),
    q(`SELECT country AS k, event, SUM(count) AS n ${range} GROUP BY country, event`),
    q(`SELECT ref AS k, event, SUM(count) AS n ${range} GROUP BY ref, event`),
    q(`SELECT utm AS k, event, SUM(count) AS n ${range} AND utm <> '' GROUP BY utm, event`),
    q(
      `SELECT s.wallpaper_id AS k, 'wallpaper_install' AS event, SUM(s.count) AS n, w.title AS title
       FROM stats_daily s LEFT JOIN wallpapers w ON w.id = s.wallpaper_id
       WHERE s.day >= ? AND s.day <= ? AND s.event = 'wallpaper_install' GROUP BY s.wallpaper_id ORDER BY n DESC LIMIT 10`,
    ),
  ]);
  const totals = zero();
  const byDay = new Map<string, Counts>();
  for (const r of daily.results) {
    totals[r.event] += r.n;
    const c = byDay.get(r.k) ?? zero();
    c[r.event] += r.n;
    byDay.set(r.k, c);
  }
  const series: StatsReport["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - i * 86400_000));
    series.push({ day, ...(byDay.get(day) ?? zero()) });
  }
  return {
    days,
    from,
    to,
    totals,
    daily: series,
    countries: pivot(countries.results, "country", 250),
    referrers: pivot(refs.results, "ref", 20),
    utm: pivot(utm.results, "utm", 20),
    wallpapers: wps.results.map((r) => ({ id: r.k, title: r.title ?? null, installs: r.n })),
  };
}

// ---------------------------------------------------------------------------
// GitHub release downloads (direct downloads bypass /download, so show GitHub's own count)
// ---------------------------------------------------------------------------
export const GITHUB_RELEASES_API = "https://api.github.com/repos/amontheptanlaeo/MacWallpaperPro/releases?per_page=100";
const GH_CACHE_KEY = "https://macwallpaper.elizos.com/__cache/github-releases-v1";
const GH_TTL = 600;

export interface GithubCounts {
  total: number;
  latest: { tag: string; downloads: number } | null;
}

interface GhRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; download_count?: number }[];
}

export function summarizeReleases(list: GhRelease[]): GithubCounts {
  const sum = (r: GhRelease) => (r.assets ?? []).reduce((a, x) => a + (Number.isFinite(x.download_count) ? Number(x.download_count) : 0), 0);
  const published = list.filter((r) => !r.draft);
  const latest = published.find((r) => !r.prerelease) ?? null;
  return {
    total: published.reduce((a, r) => a + sum(r), 0),
    latest: latest ? { tag: String(latest.tag_name ?? ""), downloads: sum(latest) } : null,
  };
}

/** Cached ~10 minutes with the Cache API; null when GitHub can't be reached. */
export async function githubCounts(): Promise<GithubCounts | null> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  try {
    const hit = await cache?.match(GH_CACHE_KEY);
    if (hit) return (await hit.json()) as GithubCounts;
  } catch {
    // cache unavailable: fall through
  }
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "MacWallpaperPro-site", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const list = (await res.json()) as unknown;
    if (!Array.isArray(list)) return null;
    const out = summarizeReleases(list as GhRelease[]);
    try {
      await cache?.put(GH_CACHE_KEY, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${GH_TTL}` } }));
    } catch {
      // not cacheable here (e.g. workers.dev): fine
    }
    return out;
  } catch {
    return null;
  }
}
