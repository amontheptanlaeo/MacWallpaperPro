import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/crypto";
import { call, register } from "./helpers";

describe("auth", () => {
  it("registers, sets a hardened session cookie, and stores a PBKDF2 hash", async () => {
    const { res, cookie, email, id } = await register();
    expect(res.status).toBe(201);
    const sc = res.headers.get("Set-Cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/Secure/);
    expect(sc).toMatch(/SameSite=Lax/);
    const me = await call("/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id, email, role: "user", creator: { connected: false, payoutsEnabled: false } });

    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(id).first<{ password_hash: string }>();
    expect(row!.password_hash).toMatch(/^pbkdf2-sha256\$3x70000\$/);
    expect(row!.password_hash).not.toContain("correct horse");
    // session stored hashed, never the raw cookie value
    const raw = cookie.split("=")[1];
    const s = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(raw).first<{ n: number }>();
    expect(s!.n).toBe(0);
  });

  it("rejects wrong passwords and accepts the right one", async () => {
    const { email, password } = await register();
    const bad = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password: "nope nope nope" }) });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_credentials" } });
    const good = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    expect(good.status).toBe(200);
  });

  it("rejects duplicate email and weak passwords", async () => {
    const { email } = await register();
    const dup = await call("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password: "another long pw", displayName: "x" }) });
    expect(dup.status).toBe(409);
    const weak = await call("/api/auth/register", { method: "POST", body: JSON.stringify({ email: "w@example.com", password: "short", displayName: "x" }) });
    expect(weak.status).toBe(400);
  });

  it("requires a matching Origin on state-changing requests", async () => {
    const { cookie } = await register();
    const foreign = await call("/api/auth/logout", { method: "POST", cookie, headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "bad_origin" } });
    const none = await call("/api/auth/logout", { method: "POST", cookie, noOrigin: true });
    expect(none.status).toBe(403);
  });

  it("logout invalidates the session", async () => {
    const { cookie } = await register();
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });

  it("bootstraps admins from ADMIN_EMAILS", async () => {
    const { body } = await register("admin@example.com");
    expect(body.role).toBe("admin");
  });

  it("rate limits login attempts per IP", async () => {
    const ip = "203.0.113.77";
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await call("/api/auth/login", {
        method: "POST",
        headers: { "CF-Connecting-IP": ip },
        body: JSON.stringify({ email: `nobody${i}@example.com`, password: "whatever123" }),
      });
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it("/app/connect issues a hashed, revocable 90-day bearer token via deep link", async () => {
    const { cookie, id } = await register();
    const anon = await call("/app/connect");
    expect(anon.status).toBe(302);
    const page = await call("/app/connect", { cookie });
    expect(page.status).toBe(200);
    const res = await call("/app/connect", { method: "POST", cookie });
    expect(res.status).toBe(303);
    const loc = res.headers.get("Location")!;
    expect(loc).toMatch(/^macwallpaperpro:\/\/auth\?token=mwp_/);
    const token = decodeURIComponent(loc.split("token=")[1]);

    const row = await env.DB.prepare("SELECT token_hash, expires_at FROM api_tokens WHERE user_id = ?").bind(id).first<{ token_hash: string; expires_at: string }>();
    expect(row!.token_hash).not.toBe(token);
    const days = (Date.parse(row!.expires_at) - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThanOrEqual(90);

    const me = await call("/api/me", { bearer: token });
    expect(me.status).toBe(200);
    // Bearer clients (the app) send no Origin; that is allowed.
    const list = (await (await call("/api/me/tokens", { bearer: token })).json()) as { items: { id: string }[] };
    const revoke = await call(`/api/me/tokens/${list.items[0].id}/revoke`, { method: "POST", bearer: token, noOrigin: true });
    expect(revoke.status).toBe(200);
    const after = await call("/api/me", { bearer: token });
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ error: { code: "invalid_token" } });
  });

  it("password hashes use 210k total PBKDF2 iterations and verify correctly", async () => {
    const h = await hashPassword("ลองรหัสผ่านไทย 123");
    const [, cfg] = h.split("$");
    const [rounds, iters] = cfg.split("x").map(Number);
    expect(rounds * iters).toBeGreaterThanOrEqual(210_000);
    // Production Workers reject >100k iterations per deriveBits call, so each round stays <= 100k.
    expect(iters).toBeLessThanOrEqual(100_000);
    expect(await verifyPassword("ลองรหัสผ่านไทย 123", h)).toBe(true);
    expect(await verifyPassword("ลองรหัสผ่านไทย 124", h)).toBe(false);
    // two hashes of the same password differ (random salt)
    expect(await hashPassword("x")).not.toBe(await hashPassword("x"));
  });
});
