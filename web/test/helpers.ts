import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { createSession, sessionCookies } from "../src/lib/auth";
import { randomId, sha256Hex } from "../src/lib/crypto";
import worker from "../src/index";

export const ORIGIN = "http://example.com";

type CallInit = RequestInit & { cookie?: string; noOrigin?: boolean };

function buildRequest(path: string, init: CallInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (method !== "GET" && !init.noOrigin && !headers.has("Origin")) headers.set("Origin", ORIGIN);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (!headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", "198.51.100." + ((Math.random() * 250) | 0));
  return new Request(ORIGIN + path, { ...init, method, headers, redirect: "manual" });
}

/** Call the deployed Worker entrypoint with the test bindings. */
export function call(path: string, init: CallInit = {}) {
  return exports.default.fetch(buildRequest(path, init));
}

/** Call the Worker module directly with an overridden env (e.g. production, AdSense configured). */
export async function callWith(over: Partial<Record<keyof Env, unknown>>, path: string, init: CallInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(buildRequest(path, init) as Request<unknown, IncomingRequestCfProperties>, { ...env, ...over } as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Create a creator directly in D1 and return a session cookie for it. */
export async function signedInUser(email = `u${randomId(8)}@example.com`, name = "Creator") {
  const id = "u_" + randomId(16);
  await env.DB.prepare("INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, 'user')").bind(id, email, name).run();
  const token = await createSession(env, id);
  const cookie = sessionCookies(new Request(ORIGIN), token)[0].split(";")[0];
  return { id, email, cookie };
}

export const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><canvas></canvas><script>1</script></body></html>';
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

/** Insert a wallpaper directly (bypassing upload). */
export async function insertWallpaper(opts: { ownerId: string; status?: "pending" | "approved" | "rejected"; html?: string; category?: string; title?: string }) {
  const id = randomId(12);
  const html = new TextEncoder().encode(opts.html ?? HTML);
  const sha = await sha256Hex(html);
  const fileKey = `wallpapers/${id}/v1/index.html`;
  const thumbKey = `wallpapers/${id}/thumb`;
  await env.BUCKET.put(fileKey, html);
  await env.BUCKET.put(thumbKey, PNG);
  await env.DB.prepare(
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes, file_key, thumb_key, thumb_type)
     VALUES (?, ?, ?, '', ',test,', ?, ?, 1, ?, ?, ?, ?, 'image/png')`,
  )
    .bind(id, opts.ownerId, opts.title ?? "Test " + id, opts.category ?? "abstract", opts.status ?? "approved", sha, html.byteLength, fileKey, thumbKey)
    .run();
  return { id, sha, size: html.byteLength };
}
