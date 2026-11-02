import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { call, callWith, signedInUser } from "./helpers";

const devLogin = (over: Record<string, unknown>, email = "dev@example.com") =>
  callWith(over, "/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, name: "Dev" }) });

describe("dev-only login", () => {
  it("works when ENVIRONMENT=development and sets hardened cookies", async () => {
    const res = await devLogin({ ENVIRONMENT: "development" });
    expect(res.status).toBe(200);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith("mwp_session="))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const raw = sc.split(";")[0].split("=")[1];
    const s = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").bind(raw).first<{ n: number }>();
    expect(s!.n).toBe(0); // only the hash is stored
  });

  it("is a 404 in production and any other environment, and the form is hidden", async () => {
    for (const ENVIRONMENT of ["production", "", "staging", "Development"]) {
      const res = await devLogin({ ENVIRONMENT });
      expect(res.status, ENVIRONMENT).toBe(404);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("mwp_session="))).toBe(false);
    }
    const page = await (await callWith({ ENVIRONMENT: "production" }, "/signin")).text();
    expect(page).not.toContain('action="/auth/dev"');
    const devPage = await (await callWith({ ENVIRONMENT: "development" }, "/signin")).text();
    expect(devPage).toContain('action="/auth/dev"');
  });

  it("requires a same-site Origin", async () => {
    const res = await callWith({ ENVIRONMENT: "development" }, "/auth/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ email: "x@example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("sessions", () => {
  it("/api/me works with a session and logout invalidates it", async () => {
    const { cookie, email } = await signedInUser();
    expect(await (await call("/api/me", { cookie })).json()).toMatchObject({ email, role: "user" });
    const foreign = await call("/api/auth/logout", { method: "POST", cookie, headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect((await call("/api/auth/logout", { method: "POST", cookie, noOrigin: true })).status).toBe(403);
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/api/me", { cookie })).status).toBe(401);
  });

  it("the removed bearer-token flow is gone", async () => {
    expect((await call("/app/connect")).status).toBe(404);
    expect((await call("/api/me", { headers: { Authorization: "Bearer mwp_anything" } })).status).toBe(401);
  });

  it("protected pages send visitors to sign-in", async () => {
    const r = await call("/community/mine");
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/signin?next=%2Fcommunity%2Fmine");
    const up = await (await call("/community/upload")).text();
    expect(up).toContain("/auth/google/start?next=%2Fcommunity%2Fupload");
  });
});
