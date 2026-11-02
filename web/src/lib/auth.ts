import { HttpError } from "./http";
import { base64Url, randomBytes, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "mwp_session";
export const SESSION_TTL_DAYS = 30;
export const API_TOKEN_TTL_DAYS = 90;

export type Role = "user" | "admin";
export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  stripeAccountId: string | null;
  payoutsEnabled: boolean;
}
export interface AuthContext {
  user: User;
  via: "session" | "token";
  credentialHash: string;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  stripe_account_id: string | null;
  payouts_enabled: number;
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
    role: r.role === "admin" || isAdminEmail(env, r.email) ? "admin" : "user",
    stripeAccountId: r.stripe_account_id,
    payoutsEnabled: !!r.payouts_enabled,
  };
}

const USER_COLS = "u.id, u.email, u.display_name, u.role, u.stripe_account_id, u.payouts_enabled";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function bearerToken(request: Request): string | null {
  const h = request.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

/** Resolve the current user from a Bearer token (app) or the session cookie (web). */
export async function getAuth(request: Request, env: Env): Promise<AuthContext | null> {
  const now = new Date().toISOString();
  const bearer = bearerToken(request);
  if (bearer) {
    const hash = await sha256Hex(bearer);
    const row = await env.DB.prepare(
      `SELECT ${USER_COLS} FROM api_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ?`,
    )
      .bind(hash, now)
      .first<UserRow>();
    // An invalid bearer token is an error, never a silent fallback to cookie auth.
    if (!row) throw new HttpError(401, "invalid_token", "โทเคนไม่ถูกต้องหรือหมดอายุ เชื่อมบัญชีในแอปใหม่อีกครั้ง");
    return { user: rowToUser(env, row), via: "token", credentialHash: hash };
  }
  const sid = readCookie(request, SESSION_COOKIE);
  if (!sid) return null;
  const hash = await sha256Hex(sid);
  const row = await env.DB.prepare(
    `SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(hash, now)
    .first<UserRow>();
  if (!row) return null;
  return { user: rowToUser(env, row), via: "session", credentialHash: hash };
}

export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const a = await getAuth(request, env);
  if (!a) throw new HttpError(401, "unauthorized", "กรุณาเข้าสู่ระบบก่อน");
  return a;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const a = await requireAuth(request, env);
  if (a.user.role !== "admin") throw new HttpError(403, "forbidden", "เฉพาะผู้ดูแลระบบเท่านั้น");
  return a;
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = base64Url(randomBytes(32));
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(token), userId, addDays(SESSION_TTL_DAYS))
    .run();
  return token;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_DAYS * 86400}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createApiToken(env: Env, userId: string, label: string) {
  const token = "mwp_" + base64Url(randomBytes(32));
  const id = crypto.randomUUID();
  const expiresAt = addDays(API_TOKEN_TTL_DAYS);
  await env.DB.prepare("INSERT INTO api_tokens (id, user_id, token_hash, label, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, userId, await sha256Hex(token), label, expiresAt)
    .run();
  return { id, token, expiresAt };
}

/**
 * CSRF defense: every state-changing request must carry an Origin that matches this host
 * (or ALLOWED_ORIGINS). Requests authenticated purely by Bearer token (the macOS app) carry no
 * ambient credentials, so they are exempt when no Origin is sent.
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
  if (origin) {
    if (!allowed.has(origin)) throw new HttpError(403, "bad_origin", "คำขอนี้มาจากเว็บไซต์อื่น จึงถูกปฏิเสธ");
    return;
  }
  if (bearerToken(request) && !request.headers.get("Cookie")) return;
  throw new HttpError(403, "bad_origin", "คำขอไม่มี Origin จึงถูกปฏิเสธ");
}
