import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { createSession, sessionCookies } from "../src/lib/auth";
import { base64ToBytes, randomId, sha256Hex } from "../src/lib/crypto";
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

/** Minimal ISO-BMFF header ("ftyp" box, brand isom) followed by filler: enough for the server's MP4 check. */
export function fakeMp4(size = 4096): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31], 0);
  for (let i = 24; i < size; i++) b[i] = (i * 31) & 0xff;
  return b;
}

/** Insert an approved (or pending) video wallpaper directly, with its bytes in R2. */
export async function insertVideo(opts: { ownerId: string; status?: "pending" | "approved" | "rejected"; bytes?: Uint8Array; category?: string; draft?: boolean }) {
  const id = randomId(12);
  const bytes = opts.bytes ?? fakeMp4();
  const sha = await sha256Hex(bytes);
  const fileKey = `wallpapers/${id}/v1/video.mp4`;
  const thumbKey = `wallpapers/${id}/thumb`;
  if (!opts.draft) await env.BUCKET.put(fileKey, bytes);
  await env.BUCKET.put(thumbKey, PNG);
  await env.DB.prepare(
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes, file_key, thumb_key, thumb_type,
       kind, credit, license, source_url, draft)
     VALUES (?, ?, ?, '', ',test,', ?, ?, 1, ?, ?, ?, ?, 'image/png', 'video', 'NASA Goddard', 'Public domain (NASA)', 'https://svs.gsfc.nasa.gov/1', ?)`,
  )
    .bind(id, opts.ownerId, "Video " + id, opts.category ?? "space", opts.status ?? "approved", opts.draft ? "" : sha, opts.draft ? 0 : bytes.byteLength, fileKey, thumbKey, opts.draft ? 1 : 0)
    .run();
  return { id, sha, size: bytes.byteLength, bytes };
}

/** Public key the manifests in this test run are signed with (real or ephemeral, see vitest.config.ts). */
export function signingPublicKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64ToBytes(env.TEST_SIGNING_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
}
