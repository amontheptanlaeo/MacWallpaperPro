// OAuth 2.0 authorization-code flow with `state` + PKCE (S256), implemented with plain fetch.
// Cost per sign-in: one SHA-256 for the PKCE challenge and 2-3 subrequests; no password hashing.
import { isSecure, type ProviderProfile } from "./auth";
import { base64Url, pkceChallenge, randomBytes, timingSafeEqualStr } from "./crypto";
import { HttpError } from "./http";
import { readCookie } from "./i18n";

export type ProviderId = "google" | "github";
export const OAUTH_COOKIE = "mwp_oauth";
const STATE_TTL_SEC = 600;

interface Provider {
  id: ProviderId;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: (env: Env) => string;
  clientSecret: (env: Env) => string;
  extraParams?: Record<string, string>;
  profile: (accessToken: string) => Promise<ProviderProfile>;
}

const UA = "MacWallpaperPro-Web";

async function getJson<T>(url: string, token: string, extra: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": UA, ...extra } });
  if (!res.ok) throw new HttpError(502, "oauth_profile_failed", `Profile request failed (${res.status}).`);
  return (await res.json()) as T;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  google: {
    id: "google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: (env) => String(env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: (env) => String((env as unknown as Record<string, string>).GOOGLE_CLIENT_SECRET || "").trim(),
    extraParams: { prompt: "select_account" },
    async profile(token) {
      const p = await getJson<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(
        "https://openidconnect.googleapis.com/v1/userinfo",
        token,
      );
      if (!p.sub || !p.email || p.email_verified !== true) throw new HttpError(403, "email_unverified", "Google account email is not verified.");
      return { provider: "google", providerUserId: String(p.sub), email: p.email, name: p.name || "", avatarUrl: p.picture || null };
    },
  },
  github: {
    id: "github",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    clientId: (env) => String(env.GITHUB_CLIENT_ID || "").trim(),
    clientSecret: (env) => String((env as unknown as Record<string, string>).GITHUB_CLIENT_SECRET || "").trim(),
    extraParams: { allow_signup: "true" },
    async profile(token) {
      const gh = { "X-GitHub-Api-Version": "2022-11-28" };
      const u = await getJson<{ id: number; login: string; name: string | null; avatar_url?: string }>("https://api.github.com/user", token, gh);
      const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>("https://api.github.com/user/emails", token, gh);
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
      if (!u.id || !primary) throw new HttpError(403, "email_unverified", "GitHub account has no verified primary email.");
      return { provider: "github", providerUserId: String(u.id), email: primary.email, name: u.name || u.login, avatarUrl: u.avatar_url || null };
    },
  },
};

/** A provider is enabled only when both its client id and secret are configured. */
export function enabledProviders(env: Env): ProviderId[] {
  return (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => PROVIDERS[id].clientId(env) && PROVIDERS[id].clientSecret(env));
}

export function isDevLoginEnabled(env: Env): boolean {
  return String(env.ENVIRONMENT || "") === "development";
}

/** Only same-site relative paths are allowed as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 300) return "/community/upload";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f]/.test(next)) return "/community/upload";
  return next;
}

function redirectUri(request: Request, id: ProviderId): string {
  return `${new URL(request.url).origin}/auth/${id}/callback`;
}

function stateCookie(request: Request, value: string, maxAge: number): string {
  const secure = isSecure(request) ? "; Secure" : "";
  return `${OAUTH_COOKIE}=${value}; Path=/auth; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearStateCookie(request: Request): string {
  return stateCookie(request, "", 0);
}

/** Step 1: redirect the browser to the provider with a fresh state + PKCE verifier bound to a cookie. */
export async function startAuthorization(request: Request, env: Env, id: ProviderId): Promise<Response> {
  const p = PROVIDERS[id];
  if (!enabledProviders(env).includes(id)) throw new HttpError(404, "provider_disabled", "This sign-in method is not configured.");
  const url = new URL(request.url);
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48)); // 64 chars, within RFC 7636's 43..128
  const next = safeNext(url.searchParams.get("next"));
  const params = new URLSearchParams({
    client_id: p.clientId(env),
    redirect_uri: redirectUri(request, id),
    response_type: "code",
    scope: p.scope,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    ...(p.extraParams ?? {}),
  });
  const cookie = [id, state, verifier, base64Url(new TextEncoder().encode(next))].join(".");
  return new Response(null, {
    status: 302,
    headers: { Location: `${p.authorizeUrl}?${params}`, "Set-Cookie": stateCookie(request, cookie, STATE_TTL_SEC), "Cache-Control": "no-store" },
  });
}

function decodeNext(b64url: string): string {
  try {
    const b = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
    return safeNext(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))));
  } catch {
    return "/community/upload";
  }
}

/**
 * Step 2: validate `state` against the cookie (timing-safe), exchange the code with the PKCE verifier,
 * then load a verified profile. Throws HttpError on any mismatch.
 */
export async function completeAuthorization(request: Request, env: Env, id: ProviderId): Promise<{ profile: ProviderProfile; next: string }> {
  const p = PROVIDERS[id];
  if (!enabledProviders(env).includes(id)) throw new HttpError(404, "provider_disabled", "This sign-in method is not configured.");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw new HttpError(400, "oauth_denied", "Sign-in was cancelled.");
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const raw = readCookie(request, OAUTH_COOKIE) || "";
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== id) throw new HttpError(400, "oauth_state", "Sign-in session expired. Try again.");
  const [, expectedState, verifier, nextB64] = parts;
  if (!state || !code || code.length > 2048 || !timingSafeEqualStr(state, expectedState)) {
    throw new HttpError(400, "oauth_state", "Sign-in state did not match. Try again.");
  }

  const tokenRes = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": UA },
    body: new URLSearchParams({
      client_id: p.clientId(env),
      client_secret: p.clientSecret(env),
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(request, id),
    }),
  });
  const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tok.access_token) throw new HttpError(502, "oauth_token_failed", "The provider rejected the sign-in.");
  const profile = await p.profile(tok.access_token);
  return { profile, next: decodeNext(nextB64) };
}
