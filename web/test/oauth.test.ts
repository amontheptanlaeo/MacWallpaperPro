import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pkceChallenge } from "../src/lib/crypto";
import { safeNext } from "../src/lib/oauth";
import { call, callWith } from "./helpers";

function cookieValue(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    if (kv.slice(0, i) === name) return kv.slice(i + 1);
  }
  return null;
}

async function start(provider: "google" | "github", next = "/community/upload") {
  const res = await callWith({}, `/auth/${provider}/start?next=${encodeURIComponent(next)}`);
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get("Location")!);
  const raw = cookieValue(res, "mwp_oauth")!;
  const [, state, verifier] = raw.split(".");
  return { res, loc, raw, state, verifier };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function mockProvider(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { calls, spy };
}
const jsonRes = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.restoreAllMocks());

describe("OAuth start", () => {
  it("redirects to Google with state, S256 PKCE challenge and the exact callback URL", async () => {
    const { res, loc, state, verifier } = await start("google");
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(loc.searchParams.get("client_id")).toBe("google-test-client");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://example.com/auth/google/callback");
    expect(loc.searchParams.get("response_type")).toBe("code");
    expect(loc.searchParams.get("scope")).toBe("openid email profile");
    expect(loc.searchParams.get("state")).toBe(state);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toBe(await pkceChallenge(verifier));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    const sc = res.headers.getSetCookie().find((c) => c.startsWith("mwp_oauth="))!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    expect(sc).toMatch(/Path=\/auth/);
    expect(sc).toMatch(/Max-Age=600/);
  });

  it("uses GitHub's endpoints with PKCE and the /auth/github/callback path", async () => {
    const { loc, verifier } = await start("github");
    expect(loc.origin + loc.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://example.com/auth/github/callback");
    expect(loc.searchParams.get("code_challenge")).toBe(await pkceChallenge(verifier));
  });

  it("is disabled when a provider's id or secret is missing", async () => {
    const res = await callWith({ GOOGLE_CLIENT_SECRET: "" }, "/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^\/signin\?error=/);
    const page = await (await callWith({ GOOGLE_CLIENT_SECRET: "", GITHUB_CLIENT_ID: "" }, "/signin")).text();
    expect(page).not.toContain("/auth/google/start");
    expect(page).not.toContain("/auth/github/start");
  });

  it("only allows same-site relative post-login destinations", () => {
    expect(safeNext("/community/mine")).toBe("/community/mine");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "", null]) {
      expect(safeNext(bad as string)).toBe("/community/upload");
    }
  });
});

describe("OAuth callback", () => {
  it("rejects a state that does not match the cookie, without calling the provider", async () => {
    const { raw } = await start("google");
    const { calls } = mockProvider(() => jsonRes({}));
    const res = await callWith({}, `/auth/google/callback?code=abc&state=forged`, { cookie: `mwp_oauth=${raw}` });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/signin?error=oauth_state");
    expect(cookieValue(res, "mwp_session")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects a callback with no state cookie, or a cookie for another provider", async () => {
    const { raw, state } = await start("github");
    mockProvider(() => jsonRes({}));
    const none = await callWith({}, `/auth/google/callback?code=abc&state=${state}`);
    expect(none.headers.get("Location")).toBe("/signin?error=oauth_state");
    const swapped = await callWith({}, `/auth/google/callback?code=abc&state=${state}`, { cookie: `mwp_oauth=${raw}` });
    expect(swapped.headers.get("Location")).toBe("/signin?error=oauth_state");
  });

  it("exchanges the code with the PKCE verifier, creates a session and redirects to next (Google)", async () => {
    const { raw, state, verifier } = await start("google", "/community/mine");
    const { calls } = mockProvider((url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        const body = new URLSearchParams(String(init.body));
        if (body.get("code_verifier") !== verifier || body.get("client_secret") !== "google-test-secret" || body.get("code") !== "good-code")
          return jsonRes({ error: "invalid_grant" }, 400);
        return jsonRes({ access_token: "ya29.test", token_type: "Bearer" });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        expect(new Headers(init.headers).get("Authorization")).toBe("Bearer ya29.test");
        return jsonRes({ sub: "g-123", email: "admin@example.com", email_verified: true, name: "Ada Admin", picture: "https://lh3.googleusercontent.com/a" });
      }
      return jsonRes({}, 404);
    });
    const res = await callWith({}, `/auth/google/callback?code=good-code&state=${state}`, { cookie: `mwp_oauth=${raw}` });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/community/mine");
    expect(calls.map((c) => c.url)).toEqual(["https://oauth2.googleapis.com/token", "https://openidconnect.googleapis.com/v1/userinfo"]);
    const session = cookieValue(res, "mwp_session");
    expect(session).toBeTruthy();
    expect(cookieValue(res, "mwp_oauth")).toBe(""); // state cookie cleared
    vi.restoreAllMocks();
    const me = (await (await call("/api/me", { cookie: `mwp_session=${session}` })).json()) as Record<string, unknown>;
    expect(me).toMatchObject({ email: "admin@example.com", displayName: "Ada Admin", role: "admin" });
    const ident = await env.DB.prepare("SELECT provider, provider_user_id FROM identities WHERE provider = 'google'").first();
    expect(ident).toMatchObject({ provider: "google", provider_user_id: "g-123" });
  });

  it("refuses Google accounts without a verified email", async () => {
    const { raw, state } = await start("google");
    mockProvider((url) =>
      url.includes("/token") ? jsonRes({ access_token: "t" }) : jsonRes({ sub: "g-9", email: "x@example.com", email_verified: false }),
    );
    const res = await callWith({}, `/auth/google/callback?code=c&state=${state}`, { cookie: `mwp_oauth=${raw}` });
    expect(res.headers.get("Location")).toBe("/signin?error=email_unverified");
    expect(cookieValue(res, "mwp_session")).toBeNull();
  });

  it("signs in with GitHub using the primary verified email", async () => {
    const { raw, state } = await start("github");
    mockProvider((url, init) => {
      if (url === "https://github.com/login/oauth/access_token") {
        expect(new URLSearchParams(String(init.body)).get("code_verifier")).toBeTruthy();
        return jsonRes({ access_token: "gho_test" });
      }
      if (url === "https://api.github.com/user") return jsonRes({ id: 42, login: "octo", name: null, avatar_url: "https://avatars.githubusercontent.com/u/42" });
      if (url === "https://api.github.com/user/emails")
        return jsonRes([
          { email: "old@example.com", primary: false, verified: true },
          { email: "octo@example.com", primary: true, verified: true },
        ]);
      return jsonRes({}, 404);
    });
    const res = await callWith({}, `/auth/github/callback?code=c&state=${state}`, { cookie: `mwp_oauth=${raw}` });
    expect(res.headers.get("Location")).toBe("/community/upload");
    const user = await env.DB.prepare("SELECT email, display_name FROM users WHERE email = 'octo@example.com'").first();
    expect(user).toMatchObject({ email: "octo@example.com", display_name: "octo" });
  });

  it("reports a provider token error as a failed sign-in", async () => {
    const { raw, state } = await start("github");
    mockProvider(() => jsonRes({ error: "bad_verification_code" }, 200));
    const res = await callWith({}, `/auth/github/callback?code=c&state=${state}`, { cookie: `mwp_oauth=${raw}` });
    expect(res.headers.get("Location")).toBe("/signin?error=oauth_token_failed");
  });
});
