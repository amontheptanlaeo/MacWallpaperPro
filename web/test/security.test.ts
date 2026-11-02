// Regression tests for docs/security-review-2026-11-02.md.
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import worker from "../src/index";
import { describe, expect, it } from "vitest";
import { scanHtml } from "../src/lib/validate";
import { call, callWith, insertWallpaper, ORIGIN, signedInUser } from "./helpers";

const cursor = (v: unknown) => encodeURIComponent(btoa(JSON.stringify(v)).replace(/=+$/, ""));

describe("#2 admin rights follow ADMIN_EMAILS", () => {
  it("demotes a stored admin whose email is no longer listed, on the next session load", async () => {
    const u = await signedInUser(`former-${crypto.randomUUID().slice(0, 8)}@example.com`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(u.id).run();
    // Listed: admin.
    const listed = await callWith({ ADMIN_EMAILS: u.email }, "/api/me", { cookie: u.cookie });
    expect(await listed.json()).toMatchObject({ role: "admin" });
    // Removed from ADMIN_EMAILS: a plain user immediately, and the cached role is rewritten.
    const me = await callWith({ ADMIN_EMAILS: "someone-else@example.com" }, "/api/me", { cookie: u.cookie });
    expect(await me.json()).toMatchObject({ role: "user" });
    expect((await callWith({ ADMIN_EMAILS: "someone-else@example.com" }, "/api/admin/queue", { cookie: u.cookie })).status).toBe(403);
    expect((await callWith({ ADMIN_EMAILS: "someone-else@example.com" }, "/api/admin/stats", { cookie: u.cookie })).status).toBe(403);
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(u.id).first<{ role: string }>();
    expect(row!.role).toBe("user");
  });

  it("promotes and demotes on sign-in too", async () => {
    const email = `boss-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const login = (ADMIN_EMAILS: string) =>
      callWith({ ENVIRONMENT: "development", ADMIN_EMAILS }, "/auth/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: "Boss" }),
      });
    expect(await (await login(email)).json()).toMatchObject({ role: "admin" });
    expect(await (await login("")).json()).toMatchObject({ role: "user" });
    const row = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(email).first<{ role: string }>();
    expect(row!.role).toBe("user");
  });
});

describe("#3 preview shell", () => {
  it("only accepts HTML from its same-origin parent and can only be framed by this site", async () => {
    const res = await call("/preview-sandbox");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    const html = await res.text();
    expect(html).toContain(`var O=${JSON.stringify(ORIGIN)}`);
    expect(html).toContain("e.source!==parent||e.origin!==O");
    expect(html).toContain("if(parent===window)return;"); // opened top-level: does nothing
    expect(html).toContain("removeEventListener('message',h)");
    expect(html).not.toContain("once:true");
    expect(html).not.toContain("'*'");
  });

  it("/preview/:id is frameable only by this site but still loads top-level", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const res = await call(`/preview/${wp.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toMatch(/frame-ancestors 'self'$/);
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    await res.arrayBuffer();
  });
});

describe("#4 HSTS", () => {
  it("is on JSON, HTML, errors, redirects and the root domain", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const hsts = "max-age=31536000";
    for (const p of ["/api/wallpapers", "/", "/community", "/api/nope", "/robots.txt", "/community/mine", `/api/wallpapers/${wp.id}/thumb`]) {
      const r = await call(p);
      expect(r.headers.get("Strict-Transport-Security"), p).toBe(hsts);
      await r.arrayBuffer();
    }
    const ctx = createExecutionContext();
    const apex = await worker.fetch(new Request("https://elizos.com/x", { redirect: "manual" }) as never, { ...env, SITE_URL: "https://macwallpaper.elizos.com" } as Env, ctx);
    await waitOnExecutionContext(ctx);
    expect(apex.status).toBe(301);
    expect(apex.headers.get("Strict-Transport-Security")).toBe(hsts);
  });
});

describe("#6 download counting is deduped per IP, wallpaper and day", () => {
  it("counts a repeat download from the same IP once, and never stores the IP", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const get = async (ip: string) => {
      const r = await callWith({}, `/api/wallpapers/${wp.id}/download`, { headers: { "CF-Connecting-IP": ip } });
      expect(r.status).toBe(200);
      await r.arrayBuffer();
    };
    await get("203.0.113.77");
    await get("203.0.113.77");
    await get("203.0.113.77");
    const n = async () => (await env.DB.prepare("SELECT downloads FROM wallpapers WHERE id = ?").bind(wp.id).first<{ downloads: number }>())!.downloads;
    expect(await n()).toBe(1);
    await get("198.51.100.200");
    expect(await n()).toBe(2);
    const { results } = await env.DB.prepare("SELECT * FROM download_seen").all<Record<string, unknown>>();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(["day", "hits", "key"]);
      expect(String(r.key)).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(r)).not.toContain("203.0.113.77");
    }
  });
});

describe("#7 numeric input is a 400, never a 500", () => {
  it("rejects bad limit values and clamps good ones", async () => {
    for (const limit of ["1.5", "abc", "-1", "1e3", "0x10", " 5 6", "9999999"]) {
      const r = await call(`/api/wallpapers?limit=${encodeURIComponent(limit)}`);
      expect(r.status, limit).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("invalid_limit");
    }
    for (const limit of ["", "0", "1", "24", "500"]) {
      const r = await call(`/api/wallpapers?limit=${limit}`);
      expect(r.status, limit).toBe(200);
      expect(((await r.json()) as { items: unknown[] }).items.length).toBeLessThanOrEqual(24);
    }
  });

  it("rejects malformed cursors for both sorts", async () => {
    const bad = [
      "sort=popular&cursor=" + cursor(["abc", "x"]),
      "sort=popular&cursor=" + cursor([1.5, "x"]),
      "sort=popular&cursor=" + cursor([-1, "x"]),
      "sort=popular&cursor=" + cursor([5, 7]),
      "sort=new&cursor=" + cursor([5, "x"]),
      "sort=new&cursor=" + cursor(["yesterday", "x"]),
      "sort=new&cursor=" + cursor(["2026-01-01T00:00:00.000Z"]),
      "cursor=" + encodeURIComponent("!!!not-base64"),
      "cursor=" + cursor({ a: 1 }),
    ];
    for (const q of bad) {
      const r = await call(`/api/wallpapers?${q}`);
      expect(r.status, q).toBe(400);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe("invalid_cursor");
    }
    expect((await call("/api/wallpapers?sort=popular&cursor=" + cursor([3, "abc"]))).status).toBe(200);
    expect((await call("/api/wallpapers?sort=new&cursor=" + cursor(["2026-01-01T00:00:00.000Z", "abc"]))).status).toBe(200);
  });

  it("rejects a bad stats range", async () => {
    const admin = await signedInUser(`st-${crypto.randomUUID().slice(0, 8)}@example.com`);
    for (const days of ["13", "abc", "7.5", "-7"]) {
      const r = await callWith({ ADMIN_EMAILS: admin.email }, `/api/admin/stats?days=${days}`, { cookie: admin.cookie });
      expect(r.status, days).toBe(400);
    }
  });
});

describe("#8 self-service account deletion", () => {
  it("needs a session, a same-site Origin and an explicit confirmation", async () => {
    const u = await signedInUser();
    const body = JSON.stringify({ confirm: "DELETE" });
    const headers = { "Content-Type": "application/json" };
    expect((await call("/api/me", { method: "DELETE", headers, body })).status).toBe(401);
    expect((await call("/api/me", { method: "DELETE", headers: { ...headers, Origin: "https://evil.example" }, body, cookie: u.cookie })).status).toBe(403);
    expect((await call("/api/me", { method: "DELETE", headers, body, cookie: u.cookie, noOrigin: true })).status).toBe(403);
    expect((await call("/api/me", { method: "DELETE", headers, body: "{}", cookie: u.cookie })).status).toBe(400);
    expect((await call("/api/me", { method: "DELETE", headers, body: JSON.stringify({ confirm: "delete" }), cookie: u.cookie })).status).toBe(400);
    expect((await call("/api/me", { cookie: u.cookie })).status).toBe(200); // still there
  });

  it("deletes the user, sessions, identities and every upload (D1 rows and R2 objects) and nobody else's", async () => {
    const u = await signedInUser();
    const other = await signedInUser();
    await env.DB.prepare("INSERT INTO identities (provider, provider_user_id, user_id) VALUES ('dev', ?, ?)").bind(u.email, u.id).run();
    const a = await insertWallpaper({ ownerId: u.id });
    const b = await insertWallpaper({ ownerId: u.id, status: "pending" });
    const keep = await insertWallpaper({ ownerId: other.id });
    const res = await call("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "DELETE" }), cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deletedWallpapers: 2 });
    expect(res.headers.getSetCookie().some((c) => c.startsWith("mwp_session=;") && c.includes("Max-Age=0"))).toBe(true);
    const count = async (sql: string, v: string) => (await env.DB.prepare(sql).bind(v).first<{ n: number }>())!.n;
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM identities WHERE user_id = ?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM wallpapers WHERE owner_id = ?", u.id)).toBe(0);
    for (const id of [a.id, b.id]) {
      expect(await env.BUCKET.head(`wallpapers/${id}/v1/index.html`)).toBeNull();
      expect(await env.BUCKET.head(`wallpapers/${id}/thumb`)).toBeNull();
    }
    expect(await env.BUCKET.head(`wallpapers/${keep.id}/v1/index.html`)).not.toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id = ?", other.id)).toBe(1);
    expect((await call("/api/me", { cookie: u.cookie })).status).toBe(401);
    expect((await call(`/api/wallpapers/${a.id}`)).status).toBe(404);
  });

  it("is offered on My uploads, and the privacy page no longer points to public issues", async () => {
    const u = await signedInUser();
    const mine = await (await call("/community/mine", { cookie: u.cookie })).text();
    expect(mine).toContain("data-delete-open");
    expect(mine).toContain("data-delete-modal");
    const privacy = await (await call("/privacy")).text();
    expect(privacy).not.toContain("/issues");
    expect(privacy).toContain("/security/advisories/new");
    expect(privacy).toContain('href="/community/mine"');
    expect(privacy).toContain("store IP addresses");
  });
});

describe("#9 scanner", () => {
  const ids = (html: string) => scanHtml(html).map((f) => f.id);

  it("flags common evasions as advisory findings", () => {
    expect(ids(`<script>globalThis["fet"+"ch"]("/x")</script>`)).toEqual(expect.arrayContaining(["obfuscated_name", "global_bracket"]));
    expect(ids(`<script>window['ev' + 'al']('1')</script>`)).toEqual(expect.arrayContaining(["obfuscated_name", "global_bracket"]));
    expect(ids(`<script>Function("return this")()</script>`)).toContain("function_call");
    expect(ids(`<script>eval(atob("ZmV0Y2goKQ=="))</script>`)).toEqual(expect.arrayContaining(["eval", "atob"]));
    expect(ids(`<script>import("./x.js")</script>`)).toContain("dynamic_import");
    expect(ids(`<script>location.href = "/away"</script>`)).toContain("location");
    expect(ids(`<script>location.replace("/away")</script>`)).toContain("location");
    expect(ids(`<meta http-equiv="refresh" content="0;url=/x">`)).toContain("meta_refresh");
    expect(ids(`<base href="/x/">`)).toContain("base_tag");
  });

  it("does not flag ordinary code", () => {
    expect(ids(`<html><script>function draw(){ const a = [1,2]; if (location.hash == "#x") {} requestAnimationFrame(draw) }</script></html>`)).toEqual([]);
    expect(ids(`<script>new Function("x")</script>`)).toEqual(["function_ctor"]);
  });

  it("the moderation queue says a clean result is not proof of safety", async () => {
    const admin = await signedInUser(`mod-${crypto.randomUUID().slice(0, 8)}@example.com`);
    const page = await (await callWith({ ADMIN_EMAILS: admin.email }, "/community/admin", { cookie: admin.cookie })).text();
    expect(page).toContain("A clean result does not prove a wallpaper is safe");
    expect(page).toContain('href="/community/admin/stats"');
  });
});
