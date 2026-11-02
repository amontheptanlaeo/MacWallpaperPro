import { env, exports } from "cloudflare:workers";
import { randomId, sha256Hex } from "../src/lib/crypto";

export const ORIGIN = "http://example.com";

export function call(path: string, init: RequestInit & { cookie?: string; bearer?: string; noOrigin?: boolean } = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && !init.noOrigin && !headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.bearer) headers.set("Authorization", `Bearer ${init.bearer}`);
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "198.51.100." + ((Math.random() * 250) | 0));
  return exports.default.fetch(new Request(ORIGIN + path, { ...init, method, headers, redirect: "manual" }));
}

export async function register(email = `u${randomId(8)}@example.com`, password = "correct horse battery", displayName = "ทดสอบ") {
  const res = await call("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  });
  const setCookie = res.headers.get("Set-Cookie") || "";
  const cookie = setCookie.split(";")[0];
  const body = (await res.json()) as { id: string; role: string };
  return { res, cookie, email, password, id: body.id, body };
}

export const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><canvas></canvas><script>1</script></body></html>';
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** Insert a wallpaper directly (bypassing upload) for entitlement tests. */
export async function insertWallpaper(opts: { ownerId: string; priceCents: number; status?: "pending" | "approved" | "rejected"; html?: string }) {
  const id = randomId(12);
  const html = new TextEncoder().encode(opts.html ?? HTML);
  const sha = await sha256Hex(html);
  const fileKey = `wallpapers/${id}/v1/index.html`;
  const thumbKey = `wallpapers/${id}/thumb`;
  await env.BUCKET.put(fileKey, html);
  await env.BUCKET.put(thumbKey, PNG);
  await env.DB.prepare(
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, price_cents, status, version, sha256, size_bytes, file_key, thumb_key, thumb_type)
     VALUES (?, ?, ?, '', ',test,', ?, ?, 1, ?, ?, ?, ?, 'image/png')`,
  )
    .bind(id, opts.ownerId, "ทดสอบ " + id, opts.priceCents, opts.status ?? "approved", sha, html.byteLength, fileKey, thumbKey)
    .run();
  return { id, sha, size: html.byteLength };
}
