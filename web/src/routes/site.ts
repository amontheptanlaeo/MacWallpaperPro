// Server-rendered pages and the sign-in flow.
import { adsTxt } from "../lib/ads";
import { clearSessionCookies, createSession, getAuth, sessionCookies, upsertUser } from "../lib/auth";
import { clientIp, HttpError, json, SECURITY_HEADERS } from "../lib/http";
import { LANG_COOKIE, languageByCode, readCookie } from "../lib/i18n";
import {
  clearStateCookie,
  completeAuthorization,
  enabledProviders,
  isDevLoginEnabled,
  safeNext,
  startAuthorization,
  type ProviderId,
} from "../lib/oauth";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import { background, githubCounts, parseDays, recordAppDownload, statsReport, trackPageView, utmFrom } from "../lib/stats";
import { CATEGORIES, isCategory } from "../lib/validate";
import { toDetail, toSummary, type WallpaperRow, type WallpaperSummary } from "../lib/wallpapers";
import { errorPage, makeCtx, siteUrl } from "../views/layout";
import * as views from "../views/pages";
import { loadWallpaper, queryWallpapers } from "./public";

export const RELEASE_KEY = "releases/MacWallpaperPro.zip";
/** The installer lives on GitHub Releases (free, unlimited bandwidth); /latest always points at the newest. */
export const GITHUB_RELEASE_URL = "https://github.com/amontheptanlaeo/MacWallpaperPro/releases/latest/download/MacWallpaperPro.zip";

function redirect(location: string, cookies: string[] = [], status = 302): Response {
  const h = new Headers({ Location: location, "Cache-Control": "no-store", ...SECURITY_HEADERS });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status, headers: h });
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
export async function landing(request: Request, env: Env, ec: ExecutionContext): Promise<Response> {
  trackPageView(ec, env, request);
  const ctx = makeCtx(request, env);
  const [showcase, cute, tops, counts] = await Promise.all([
    queryWallpapers(env, new URLSearchParams({ sort: "popular", exclude: "cute", limit: "5" })),
    queryWallpapers(env, new URLSearchParams({ sort: "popular", category: "cute", limit: "4" })),
    // Best-loved wallpaper per category (for the mood tiles), in a single query.
    env.DB.prepare(
      `SELECT * FROM (SELECT w.*, u.display_name AS author_name,
         ROW_NUMBER() OVER (PARTITION BY w.category ORDER BY w.downloads DESC, w.created_at DESC) AS rn
       FROM wallpapers w JOIN users u ON u.id = w.owner_id WHERE w.status = 'approved') WHERE rn <= 6 ORDER BY category, rn`,
    ).all<WallpaperRow>(),
    env.DB.prepare("SELECT category, COUNT(*) AS n FROM wallpapers WHERE status = 'approved' GROUP BY category").all<{ category: string; n: number }>(),
  ]);
  // Each mood tile shows a wallpaper that is not already on the page above it, when possible.
  const shown = new Set([...showcase.items, ...cute.items].map((w) => w.id));
  const topMap: Record<string, WallpaperSummary | undefined> = {};
  for (const r of tops.results) {
    const cur = topMap[r.category];
    if (!cur || (shown.has(cur.id) && !shown.has(r.id))) topMap[r.category] = toSummary(r);
  }
  const countMap: Record<string, number> = {};
  for (const r of counts.results) countMap[r.category] = r.n;
  return views.landingPage(ctx, { showcase: showcase.items, cute: cute.items, tops: topMap, counts: countMap });
}

export async function browse(request: Request, env: Env, ec: ExecutionContext): Promise<Response> {
  trackPageView(ec, env, request);
  const ctx = makeCtx(request, env);
  const p = ctx.url.searchParams;
  const sort = p.get("sort") === "popular" ? "popular" : "new";
  const q = (p.get("q") || "").trim().slice(0, 100);
  const c = (p.get("category") || "").toLowerCase();
  const category = isCategory(c) ? c : "all";
  const kind = p.get("kind") === "video" ? "video" : "all";
  const params = new URLSearchParams({ sort });
  if (q) params.set("q", q);
  if (category !== "all") params.set("category", category);
  if (kind === "video") params.set("kind", "video");
  const { items, next } = await queryWallpapers(env, params);
  return views.browsePage(ctx, { items, next, sort, q, category, kind });
}

export async function detail(request: Request, env: Env, ec: ExecutionContext, id: string): Promise<Response> {
  const ctx = makeCtx(request, env);
  const row = await loadWallpaper(env, id);
  const notFound = () =>
    errorPage(ctx, 404, ctx.t("detail.notFoundTitle"), ctx.t("detail.notFoundBody"), { href: "/community", label: ctx.t("detail.back") });
  if (!row) return notFound();
  if (row.status !== "approved") {
    const user = (await getAuth(request, env))?.user;
    if (!user || (user.id !== row.owner_id && user.role !== "admin")) return notFound();
  }
  if (row.status === "approved") trackPageView(ec, env, request, row.id);
  const more = row.status === "approved" ? await queryWallpapers(env, new URLSearchParams({ sort: "popular", category: row.category, limit: "5" })) : { items: [] };
  return views.detailPage(ctx, toDetail(row), more.items.filter((m) => m.id !== row.id).slice(0, 4), row.reject_reason);
}

export async function upload(request: Request, env: Env): Promise<Response> {
  const ctx = makeCtx(request, env);
  const auth = await getAuth(request, env);
  return views.uploadPage(ctx, !!auth, enabledProviders(env), isDevLoginEnabled(env));
}

export async function mine(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) return redirect(`/signin?next=${encodeURIComponent("/community/mine")}`);
  return views.minePage(makeCtx(request, env));
}

export async function admin(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) return redirect(`/signin?next=${encodeURIComponent("/community/admin")}`);
  const ctx = makeCtx(request, env);
  if (auth.user.role !== "admin") return views.forbiddenPage(ctx);
  return views.adminPage(ctx);
}

export async function adminStats(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) return redirect(`/signin?next=${encodeURIComponent("/community/admin/stats")}`);
  const ctx = makeCtx(request, env);
  if (auth.user.role !== "admin") return views.forbiddenPage(ctx);
  let days = 30;
  try {
    days = parseDays(ctx.url.searchParams.get("days"));
  } catch {
    days = 30;
  }
  const [report, github] = await Promise.all([statsReport(env, days), githubCounts()]);
  return views.statsPage(ctx, report, github);
}

export function signin(request: Request, env: Env): Response {
  const ctx = makeCtx(request, env);
  return views.signinPage(ctx, enabledProviders(env), isDevLoginEnabled(env), safeNext(ctx.url.searchParams.get("next")));
}

export function privacy(request: Request, env: Env): Response {
  return views.privacyPage(makeCtx(request, env));
}

export function notFound(request: Request, env: Env): Response {
  const ctx = makeCtx(request, env);
  return errorPage(ctx, 404, ctx.t("nf.title"), ctx.t("nf.body"), { href: "/", label: ctx.t("nf.home") });
}

/** /lang/<code>?next=/path : remember the choice for a year, then go back. Works without JavaScript. */
export function setLanguage(request: Request, code: string): Response {
  const lang = languageByCode(code);
  const next = safeNext(new URL(request.url).searchParams.get("next") || "/");
  if (!lang) return redirect(next);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(next, [`${LANG_COOKIE}=${lang.code}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`], 303);
}

export async function downloadApp(request: Request, env: Env, ec: ExecutionContext): Promise<Response> {
  // Count (in the background, once per visitor per day) right before handing out the file.
  const count = () => {
    if (request.method === "GET") background(ec, recordAppDownload(env, request, utmFrom(request)));
  };
  // 1) GitHub Releases: the file exists when GitHub answers with a redirect to the asset.
  try {
    const head = await fetch(GITHUB_RELEASE_URL, { method: "HEAD", redirect: "manual" });
    if (head.status >= 300 && head.status < 400) {
      count();
      return redirect(GITHUB_RELEASE_URL, [], 302);
    }
  } catch {
    // GitHub unreachable: try R2 next.
  }
  // 2) Fallback: R2.
  const obj = await env.BUCKET.get(RELEASE_KEY);
  if (obj) {
    count();
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(obj.size),
        "Content-Disposition": 'attachment; filename="MacWallpaperPro.zip"',
        "Cache-Control": "public, max-age=300",
        ...(obj.httpEtag ? { ETag: obj.httpEtag } : {}),
        ...SECURITY_HEADERS,
      },
    });
  }
  return views.downloadSoonPage(makeCtx(request, env));
}

export function adsTxtRoute(env: Env): Response {
  const body = adsTxt(env);
  if (!body) return new Response("# AdSense is not configured.\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

export function robots(request: Request, env: Env): Response {
  const base = siteUrl(makeCtx(request, env));
  return new Response(`User-agent: *\nDisallow: /api/\nDisallow: /preview/\nDisallow: /auth/\nDisallow: /community/mine\nDisallow: /community/admin\nSitemap: ${base}/sitemap.xml\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

export async function sitemap(request: Request, env: Env): Promise<Response> {
  const base = siteUrl(makeCtx(request, env));
  const { results } = await env.DB.prepare("SELECT id, updated_at FROM wallpapers WHERE status = 'approved' ORDER BY created_at DESC LIMIT 5000").all<{
    id: string;
    updated_at: string;
  }>();
  const urls = [
    "/",
    "/community",
    ...CATEGORIES.map((c) => `/community?category=${c}`),
    "/privacy",
  ].map((p) => `<url><loc>${base}${p.replace(/&/g, "&amp;")}</loc></url>`);
  for (const r of results) urls.push(`<url><loc>${base}/community/w/${r.id}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

// ---------------------------------------------------------------------------
// Sign-in: OAuth (Google, GitHub) + dev-only login
// ---------------------------------------------------------------------------
function parseProvider(id: string): ProviderId {
  if (id !== "google" && id !== "github") throw new HttpError(404, "not_found", "Unknown provider.");
  return id;
}

export async function oauthStart(request: Request, env: Env, id: string): Promise<Response> {
  const provider = parseProvider(id);
  if (!enabledProviders(env).includes(provider)) return redirect("/signin?error=disabled");
  await rateLimit(env, `oauth:${clientIp(request)}`, LIMITS.oauth);
  return startAuthorization(request, env, provider);
}

export async function oauthCallback(request: Request, env: Env, id: string): Promise<Response> {
  const provider = parseProvider(id);
  try {
    const { profile, next } = await completeAuthorization(request, env, provider);
    const user = await upsertUser(env, profile);
    const token = await createSession(env, user.id);
    return redirect(next, [...sessionCookies(request, token), clearStateCookie(request)]);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    console.warn(JSON.stringify({ msg: "oauth_failed", provider, code: e.code }));
    return redirect(`/signin?error=${encodeURIComponent(e.code)}`, [clearStateCookie(request)]);
  }
}

/** Local development only: sign in as any email without a provider. 404 everywhere else. */
export async function devLogin(request: Request, env: Env): Promise<Response> {
  if (!isDevLoginEnabled(env)) throw new HttpError(404, "not_found", "Not found.");
  await rateLimit(env, `dev:${clientIp(request)}`, LIMITS.devLogin);
  const ct = request.headers.get("Content-Type") || "";
  let email = "", name = "", next = "";
  if (ct.includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    email = String(b.email ?? "");
    name = String(b.name ?? "");
    next = String(b.next ?? "");
  } else {
    const f = await request.formData().catch(() => null);
    email = String(f?.get("email") ?? "");
    name = String(f?.get("name") ?? "");
    next = String(f?.get("next") ?? "");
  }
  email = email.trim().toLowerCase();
  if (!/^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/.test(email)) throw new HttpError(400, "invalid_email", "Enter an email address.");
  const user = await upsertUser(env, { provider: "dev", providerUserId: email, email, name: name || email.split("@")[0], avatarUrl: null });
  const token = await createSession(env, user.id);
  if (ct.includes("application/json")) {
    const res = json({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
    for (const c of sessionCookies(request, token)) res.headers.append("Set-Cookie", c);
    return res;
  }
  return redirect(safeNext(next), sessionCookies(request, token), 303);
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env).catch(() => null);
  if (auth) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.sessionHash).run();
  const res = json({ ok: true });
  for (const c of clearSessionCookies(request)) res.headers.append("Set-Cookie", c);
  return res;
}

export async function me(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env);
  if (!auth) {
    // Drop a stale hint cookie so the header stops asking.
    const res = json({ error: { code: "unauthorized", message: "Sign in first." } }, 401);
    if (readCookie(request, "mwp_user")) for (const c of clearSessionCookies(request)) res.headers.append("Set-Cookie", c);
    return res;
  }
  const u = auth.user;
  return json({ id: u.id, email: u.email, displayName: u.displayName, avatarUrl: u.avatarUrl, role: u.role });
}

