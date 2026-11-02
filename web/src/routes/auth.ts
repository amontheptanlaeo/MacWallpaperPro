import {
  clearSessionCookie,
  createSession,
  getAuth,
  isAdminEmail,
  requireAuth,
  rowToUser,
  sessionCookie,
} from "../lib/auth";
import { DUMMY_PASSWORD_HASH, hashPassword, randomId, sha256Hex, verifyPassword } from "../lib/crypto";
import { clientIp, HttpError, json, readJson } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import { retrieveAccount, stripeConfigured, transfersActive } from "../lib/stripe";

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function meBody(u: ReturnType<typeof rowToUser>) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    creator: { connected: !!u.stripeAccountId, payoutsEnabled: u.payoutsEnabled },
  };
}

export async function register(request: Request, env: Env): Promise<Response> {
  await rateLimit(env, `register:${clientIp(request)}`, LIMITS.register);
  const body = await readJson(request);
  const email = str(body.email).trim().toLowerCase();
  const password = str(body.password);
  const displayName = str(body.displayName).trim();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "invalid_email", "อีเมลไม่ถูกต้อง");
  if (password.length < 10) throw new HttpError(400, "weak_password", "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร");
  if (password.length > 256) throw new HttpError(400, "invalid_password", "รหัสผ่านยาวเกินไป");
  if (!displayName || [...displayName].length > 40 || /[<>]/.test(displayName))
    throw new HttpError(400, "invalid_display_name", "ชื่อที่แสดงต้องมี 1–40 ตัวอักษร และห้ามมี < หรือ >");

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) throw new HttpError(409, "email_taken", "อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบแทน");

  const id = "u_" + randomId(16);
  const role = isAdminEmail(env, email) ? "admin" : "user";
  await env.DB.prepare("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)")
    .bind(id, email, await hashPassword(password), displayName, role)
    .run();
  const token = await createSession(env, id);
  const user = rowToUser(env, { id, email, display_name: displayName, role, stripe_account_id: null, payouts_enabled: 0 });
  return json(meBody(user), 201, { "Set-Cookie": sessionCookie(token) });
}

export async function login(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  await rateLimit(env, `login:${ip}`, LIMITS.login);
  const body = await readJson(request);
  const email = str(body.email).trim().toLowerCase();
  const password = str(body.password);
  if (!email || !password) throw new HttpError(400, "invalid_credentials", "กรอกอีเมลและรหัสผ่าน");
  await rateLimit(env, `login-email:${await sha256Hex(email)}`, LIMITS.loginEmail);

  const row = await env.DB.prepare(
    "SELECT id, email, password_hash, display_name, role, stripe_account_id, payouts_enabled FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; display_name: string; role: "user" | "admin"; stripe_account_id: string | null; payouts_enabled: number }>();
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!row || !ok) throw new HttpError(401, "invalid_credentials", "อีเมลหรือรหัสผ่านไม่ถูกต้อง");

  if (isAdminEmail(env, row.email) && row.role !== "admin") {
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(row.id).run();
  }
  const token = await createSession(env, row.id);
  return json(meBody(rowToUser(env, row)), 200, { "Set-Cookie": sessionCookie(token) });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env).catch(() => null);
  if (auth?.via === "session") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(auth.credentialHash).run();
  } else if (auth?.via === "token") {
    await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE token_hash = ?")
      .bind(new Date().toISOString(), auth.credentialHash)
      .run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

export async function me(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const user = auth.user;
  // Refresh payout capability lazily until Stripe reports transfers as active.
  if (user.stripeAccountId && !user.payoutsEnabled && stripeConfigured(env)) {
    try {
      const acct = await retrieveAccount(env, user.stripeAccountId);
      if (transfersActive(acct)) {
        await env.DB.prepare("UPDATE users SET payouts_enabled = 1 WHERE id = ?").bind(user.id).run();
        user.payoutsEnabled = true;
      }
    } catch {
      /* keep stale status; Stripe is optional for /api/me */
    }
  }
  return json(meBody(user));
}

export async function listTokens(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const { results } = await env.DB.prepare(
    `SELECT id, label, created_at, expires_at, last_used_at FROM api_tokens
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
  )
    .bind(auth.user.id, new Date().toISOString())
    .all<{ id: string; label: string; created_at: string; expires_at: string; last_used_at: string | null }>();
  return json({
    items: results.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at })),
  });
}

export async function revokeToken(request: Request, env: Env, id: string): Promise<Response> {
  const auth = await requireAuth(request, env);
  const res = await env.DB.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), id, auth.user.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "not_found", "ไม่พบอุปกรณ์นี้");
  return json({ ok: true });
}
