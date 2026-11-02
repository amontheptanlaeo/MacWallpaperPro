// Anonymous, aggregated download statistics (migrations/0003_stats.sql, src/lib/stats.ts).
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPageLoad, refHost, sanitizeUtm, summarizeReleases, utcDay } from "../src/lib/stats";
import { GITHUB_RELEASE_URL } from "../src/routes/site";
import { countryName, flag } from "../src/views/stats";
import { callWith, insertWallpaper, ORIGIN, signedInUser } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const NAV = { "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "User-Agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15" };
type StatRow = { day: string; event: string; wallpaper_id: string; country: string; ref: string; utm: string; count: number };
const rows = async (event: string) =>
  (await env.DB.prepare("SELECT * FROM stats_daily WHERE event = ? ORDER BY country, ref, utm").bind(event).all<StatRow>()).results;

/** Mock GitHub: HEAD on the release asset answers 302; the releases API returns two releases. */
function mockGithub() {
  const calls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === GITHUB_RELEASE_URL) return new Response(null, { status: 302, headers: { Location: "https://objects.githubusercontent.com/x" } });
    if (url.startsWith("https://api.github.com/repos/amontheptanlaeo/MacWallpaperPro/releases")) {
      return Response.json([
        { tag_name: "v1.1.0", draft: false, prerelease: false, assets: [{ name: "MacWallpaperPro.zip", download_count: 40 }] },
        { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [{ name: "MacWallpaperPro.zip", download_count: 60 }, { name: "x.sig", download_count: 2 }] },
        { tag_name: "v2-draft", draft: true, assets: [{ download_count: 999 }] },
      ]);
    }
    return new Response("unexpected", { status: 500 });
  });
  return calls;
}

describe("helpers", () => {
  it("keeps only a normalized referrer host", () => {
    expect(refHost(null, "example.com")).toBe("(direct)");
    expect(refHost("", "example.com")).toBe("(direct)");
    expect(refHost("not a url", "example.com")).toBe("(direct)");
    expect(refHost("https://www.reddit.com/r/macapps/comments/abc?utm=1", "example.com")).toBe("reddit.com");
    expect(refHost("https://m.facebook.com/story.php?id=1", "example.com")).toBe("facebook.com");
    expect(refHost("https://mobile.twitter.com/x", "example.com")).toBe("twitter.com");
    expect(refHost("https://t.co/AbC123", "example.com")).toBe("t.co");
    expect(refHost("https://WWW.Google.COM/search?q=wallpaper", "example.com")).toBe("google.com");
    expect(refHost("https://www.tiktok.com/@someone/video/1", "example.com")).toBe("tiktok.com");
    expect(refHost("http://example.com/community?x=1", "example.com")).toBe("(internal)");
    expect(refHost("android-app://com.google.android.gm/", "example.com")).toBe("(other)");
  });

  it("sanitizes utm_source", () => {
    expect(sanitizeUtm("TikTok")).toBe("tiktok");
    expect(sanitizeUtm("news_letter-2")).toBe("news_letter-2");
    expect(sanitizeUtm('a b<script>"x"')).toBe("abscriptx");
    expect(sanitizeUtm("x".repeat(80))).toHaveLength(32);
    expect(sanitizeUtm(null)).toBe("");
    expect(sanitizeUtm("ไทย")).toBe("");
  });

  it("counts only real page loads", () => {
    const req = (h: Record<string, string>, method = "GET") => new Request(ORIGIN + "/", { method, headers: h });
    expect(isPageLoad(req(NAV))).toBe(true);
    expect(isPageLoad(req({}))).toBe(false); // fetch(), curl, link checkers
    expect(isPageLoad(req(NAV, "HEAD"))).toBe(false);
    expect(isPageLoad(req({ ...NAV, "Sec-Purpose": "prefetch" }))).toBe(false);
    expect(isPageLoad(req({ ...NAV, "Sec-Fetch-Dest": "iframe" }))).toBe(false);
    expect(isPageLoad(req({ ...NAV, "User-Agent": "Googlebot/2.1" }))).toBe(false);
  });

  it("formats countries and sums GitHub releases", () => {
    expect(flag("TH")).toBe("\u{1F1F9}\u{1F1ED}");
    expect(flag("XX")).toBe("\u{1F310}");
    expect(summarizeReleases([
      { tag_name: "v2", assets: [{ download_count: 5 }] },
      { tag_name: "v1", assets: [{ download_count: 7 }, { download_count: 1 }] },
      { tag_name: "d", draft: true, assets: [{ download_count: 100 }] },
    ])).toEqual({ total: 13, latest: { tag: "v2", downloads: 5 } });
    expect(countryName({ lang: { code: "en" }, t: (k: string) => k } as never, "JP")).toBe("Japan");
  });
});

describe("recording", () => {
  it("aggregates page views into one upserted row per (day, event, wallpaper, country, ref, utm)", async () => {
    const view = (country: string, referer?: string, path = "/") =>
      callWith({}, path, { headers: { ...NAV, ...(referer ? { Referer: referer } : {}) }, cf: { country } } as never).then((r) => r.text());
    await view("TH", "https://www.tiktok.com/@x/video/1");
    await view("TH", "https://m.tiktok.com/v/2");
    await view("JP");
    await view("TH", undefined, "/community?utm_source=TikTok");
    await callWith({}, "/", { cf: { country: "TH" } } as never).then((r) => r.text()); // not a page load
    const r = await rows("page_view");
    const day = utcDay();
    expect(r).toEqual(
      expect.arrayContaining([
        { day, event: "page_view", wallpaper_id: "", country: "TH", ref: "tiktok.com", utm: "", count: 2 },
        { day, event: "page_view", wallpaper_id: "", country: "JP", ref: "(direct)", utm: "", count: 1 },
        { day, event: "page_view", wallpaper_id: "", country: "TH", ref: "(direct)", utm: "tiktok", count: 1 },
      ]),
    );
    expect(r.reduce((a, x) => a + x.count, 0)).toBe(4);
  });

  it("stores no IP, user agent or cookie: only the aggregate columns", async () => {
    const cols = (await env.DB.prepare("PRAGMA table_info(stats_daily)").all<{ name: string }>()).results.map((c) => c.name);
    expect(cols).toEqual(["day", "event", "wallpaper_id", "country", "ref", "utm", "count"]);
    const seen = (await env.DB.prepare("PRAGMA table_info(download_seen)").all<{ name: string }>()).results.map((c) => c.name);
    expect(seen).toEqual(["key", "day", "hits"]);
  });

  it("counts a deduped wallpaper install with country and referrer, plus the detail page view", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    for (let i = 0; i < 3; i++) {
      const r = await callWith({}, `/api/wallpapers/${wp.id}/download`, { headers: { "CF-Connecting-IP": "192.0.2.10" }, cf: { country: "DE" } } as never);
      await r.arrayBuffer();
    }
    const inst = (await rows("wallpaper_install")).filter((x) => x.wallpaper_id === wp.id);
    expect(inst).toEqual([{ day: utcDay(), event: "wallpaper_install", wallpaper_id: wp.id, country: "DE", ref: "(direct)", utm: "", count: 1 }]);
    await callWith({}, `/community/w/${wp.id}`, { headers: NAV, cf: { country: "DE" } } as never).then((r) => r.text());
    expect((await rows("page_view")).some((x) => x.wallpaper_id === wp.id && x.country === "DE")).toBe(true);
  });

  it("/download still redirects (302) to GitHub Releases and is counted, with utm_source", async () => {
    mockGithub();
    const dl = (ip: string, path: string, headers: Record<string, string> = {}) =>
      callWith({}, path, { headers: { "CF-Connecting-IP": ip, ...headers }, cf: { country: "US" } } as never);
    const r = await dl("192.0.2.20", "/download?utm_source=TikTok", { Referer: "https://www.tiktok.com/@x" });
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(GITHUB_RELEASE_URL);
    await dl("192.0.2.20", "/download?utm_source=TikTok"); // same visitor, same day: not counted again
    await dl("192.0.2.21", "/download", { Referer: `${ORIGIN}/?utm_source=reddit` }); // utm from the landing page
    const a = await rows("app_download");
    expect(a).toEqual(
      expect.arrayContaining([
        { day: utcDay(), event: "app_download", wallpaper_id: "", country: "US", ref: "tiktok.com", utm: "tiktok", count: 1 },
        { day: utcDay(), event: "app_download", wallpaper_id: "", country: "US", ref: "(internal)", utm: "reddit", count: 1 },
      ]),
    );
    expect(a.reduce((s, x) => s + x.count, 0)).toBe(2);
  });
});

describe("admin views", () => {
  it("the stats API and page are admin only", async () => {
    const user = await signedInUser();
    expect((await callWith({}, "/api/admin/stats")).status).toBe(401);
    expect((await callWith({}, "/api/admin/stats", { cookie: user.cookie })).status).toBe(403);
    const page = await callWith({}, "/community/admin/stats");
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe("/signin?next=%2Fcommunity%2Fadmin%2Fstats");
    expect((await callWith({}, "/community/admin/stats", { cookie: user.cookie })).status).toBe(403);
  });

  it("reports totals, countries, referrers, campaigns, top wallpapers and GitHub counts (cached)", async () => {
    const calls = mockGithub();
    const admin = await signedInUser(`stats-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const over = { ADMIN_EMAILS: admin.email };
    type Counts = { app_download: number; wallpaper_install: number; page_view: number; total: number };
    type Report = {
      days: number; totals: Omit<Counts, "total">; daily: unknown[]; countries: ({ country: string } & Counts)[];
      referrers: ({ ref: string } & Counts)[]; utm: ({ utm: string } & Counts)[]; wallpapers: { id: string; title: string; installs: number }[];
      github: { total: number; latest: { tag: string; downloads: number } };
    };
    const report = async () => {
      const res = await callWith(over, "/api/admin/stats?days=7", { cookie: admin.cookie });
      expect(res.status).toBe(200);
      return (await res.json()) as Report;
    };
    // Deltas against a baseline, so rows written by earlier tests don't matter.
    const before = await report();
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id, title: "Sakura Night" });
    const day = utcDay();
    const ins = (event: string, wid: string, country: string, ref: string, utm: string, count: number) =>
      env.DB.prepare(
        `INSERT INTO stats_daily (day, event, wallpaper_id, country, ref, utm, count) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, event, wallpaper_id, country, ref, utm) DO UPDATE SET count = count + excluded.count`,
      ).bind(day, event, wid, country, ref, utm, count);
    await env.DB.batch([
      ins("app_download", "", "TH", "tiktok.com", "tiktok", 5),
      ins("app_download", "", "JP", "(direct)", "", 2),
      ins("wallpaper_install", wp.id, "TH", "(direct)", "", 3),
      ins("page_view", "", "TH", "tiktok.com", "tiktok", 10),
    ]);
    const s = await report();
    expect(s.days).toBe(7);
    expect(s.daily).toHaveLength(7);
    expect(s.totals.app_download - before.totals.app_download).toBe(7);
    expect(s.totals.wallpaper_install - before.totals.wallpaper_install).toBe(3);
    expect(s.totals.page_view - before.totals.page_view).toBe(10);
    const th = (r: Report) => r.countries.find((c) => c.country === "TH")?.total ?? 0;
    expect(th(s) - th(before)).toBe(18);
    expect(s.referrers.some((r) => r.ref === "tiktok.com")).toBe(true);
    const tk = (r: Report) => r.utm.find((u) => u.utm === "tiktok")?.app_download ?? 0;
    expect(tk(s) - tk(before)).toBe(5);
    expect(s.wallpapers).toContainEqual({ id: wp.id, title: "Sakura Night", installs: 3 });
    expect(s.github).toEqual({ total: 102, latest: { tag: "v1.1.0", downloads: 40 } });

    const page = await callWith(over, "/community/admin/stats?days=30", { cookie: admin.cookie });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Thailand");
    expect(html).toContain("\u{1F1F9}\u{1F1ED}");
    expect(html).toContain("tiktok.com");
    expect(html).toContain("Sakura Night");
    expect(html).toContain("<svg");
    expect(html).toContain('href="/community/admin/stats?days=30" aria-current="true"');
    // The releases API was called once; later views came from the Cache API.
    expect(calls.filter((c) => c.includes("api.github.com")).length).toBe(1);
    // A bad range on the page falls back to 30 days instead of failing.
    expect((await callWith(over, "/community/admin/stats?days=999", { cookie: admin.cookie })).status).toBe(200);
  });
});
