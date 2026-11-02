// Sessions for creators and admins. Visitors who only browse/download never need one.
import { base64Url, randomBytes, randomId, sha256Hex } from "./crypto";
import { HttpError } from "./http";
import { readCookie } from "./i18n";

export const SESSION_COOKIE = "mwp_session";
/** Non-secret hint (no HttpOnly) so static pages know whether to ask /api/me for the account menu. */
export const HINT_COOKIE = "mwp_user";
export const SESSION_TTL_DAYS = 30;

export type Role = "user" | "admin";
export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
}
export interface AuthContext {
  user: User;
  sessionHash: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: Role;
}

export function isAdminEmail(env: Env, email: string): boolean {
  const list = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function rowToUser(env: Env, r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    role: r.role === "admin" || isAdminEmail(env, r.email) ? "admin" : "user",
  };
}

export function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

/**
 * Resolve the signed-in user from the session cookie. Cost: one SHA-256 of a 43-byte token plus one
 * indexed D1 lookup, and only on routes that need it (public pages never call this).
 */
export async function getAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid || sid.length > 100) return null;
  const hash = await sha256Hex(sid);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, new Date().toISOString())
    .first<UserRow>();
  if (!row) return null;
  return { user: rowToUser(env, row), sessionHash: hash };
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const a = await getAuth(request, env);
  if (!a) throw new HttpError(401, "unauthorized", "Sign in first.");
  return a;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const a = await requireAuth(request, env);
  if (a.user.role !== "admin") throw new HttpError(403, "forbidden", "Moderators only.");
  return a;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = base64Url(randomBytes(32));
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
  // Opportunistically clear this user's expired sessions (cheap, indexed).
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, new Date().toISOString()),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), userId, expires),
  ]);
  return token;
}

export function sessionCookies(request: Request, token: string): string[] {
  const secure = isSecure(request) ? "; Secure" : "";
  const age = SESSION_TTL_DAYS * 86400;
  return [
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${age}`,
    `${HINT_COOKIE}=1; Path=/${secure}; SameSite=Lax; Max-Age=${age}`,
  ];
}

export function clearSessionCookies(request: Request): string[] {
  const secure = isSecure(request) ? "; Secure" : "";
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=0`,
    `${HINT_COOKIE}=; Path=/${secure}; SameSite=Lax; Max-Age=0`,
  ];
}

export interface ProviderProfile {
  provider: "google" | "github" | "dev";
  providerUserId: string;
  email: string; // verified
  name: string;
  avatarUrl: string | null;
}

function cleanName(name: string, email: string): string {
  const n = name.replace(/[<>\u0000-\u001f]/g, "").trim();
  return [...(n || email.split("@")[0])].slice(0, 40).join("");
}

/**
 * Find or create the user for a verified provider identity. Identities are linked by verified email,
 * so signing in with Google and GitHub under the same address reaches the same account.
 */
export async function upsertUser(env: Env, p: ProviderProfile): Promise<User> {
  const email = p.email.trim().toLowerCase();
  const linked = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role FROM identities i JOIN users u ON u.id = i.user_id
     WHERE i.provider = ? AND i.provider_user_id = ?`,
  )
    .bind(p.provider, p.providerUserId)
    .first<UserRow>();
  let row = linked;
  if (!row) {
    row = await env.DB.prepare("SELECT id, email, display_name, avatar_url, role FROM users WHERE email = ?").bind(email).first<UserRow>();
    if (!row) {
      const id = "u_" + randomId(16);
      const name = cleanName(p.name, email);
      const role: Role = isAdminEmail(env, email) ? "admin" : "user";
      await env.DB.prepare("INSERT INTO users (id, email, display_name, avatar_url, role) VALUES (?, ?, ?, ?, ?)")
        .bind(id, email, name, p.avatarUrl, role)
        .run();
      row = { id, email, display_name: name, avatar_url: p.avatarUrl, role };
    }
    await env.DB.prepare("INSERT OR IGNORE INTO identities (provider, provider_user_id, user_id) VALUES (?, ?, ?)")
      .bind(p.provider, p.providerUserId, row.id)
      .run();
  }
  if (isAdminEmail(env, row.email) && row.role !== "admin") {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(row.id).run();
    row.role = "admin";
  }
  if (p.avatarUrl && p.avatarUrl !== row.avatar_url) {
    await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(p.avatarUrl, row.id).run();
    row.avatar_url = p.avatarUrl;
  }
  return rowToUser(env, row);
}

/**
 * CSRF defense: every state-changing request must carry an Origin that matches this host
 * (or ALLOWED_ORIGINS). Nothing on this site accepts non-browser credentials, so a missing Origin
 * on a POST is always rejected.
 */
export function checkOrigin(request: Request, env: Env): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = request.headers.get("Origin");
  const self = new URL(request.url).origin;
  const allowed = new Set([
    self,
    ...String(env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  if (!origin) throw new HttpError(403, "bad_origin", "Request has no Origin header.");
  if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "Cross-site request rejected.");
}
