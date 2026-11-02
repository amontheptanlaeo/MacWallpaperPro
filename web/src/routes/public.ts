import { getAuth } from "../lib/auth";
import { background, recordInstall } from "../lib/stats";
import { HttpError, json, SECURITY_HEADERS } from "../lib/http";
import { signManifest } from "../lib/manifest";
import { CATEGORIES, isCategory, isKind } from "../lib/validate";
import { canSeeUnpublished, toDetail, toSummary, WP_SELECT, type WallpaperRow } from "../lib/wallpapers";

/**
 * Locked-down policy for wallpaper HTML (docs/ARCHITECTURE.md). `sandbox allow-scripts` without
 * allow-same-origin gives the document an opaque origin even when opened top-level (the app's
 * inspector does that), and connect-src 'none' blocks fetch/XHR/WebSocket/beacons.
 */
export const PREVIEW_CSP = "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'";

/**
 * What /preview/:id and /preview-sandbox actually send: the wallpaper policy plus
 * `frame-ancestors 'self'`, so only this site may frame them. Top-level loads (the app's
 * WKWebView inspector) are unaffected: frame-ancestors only applies to embedding.
 */
export const PREVIEW_RESPONSE_CSP = `${PREVIEW_CSP}; frame-ancestors 'self'`;

const PREVIEW_HEADERS = {
  "Content-Security-Policy": PREVIEW_RESPONSE_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()",
};

/**
 * Video preview page (docs/ARCHITECTURE.md): nothing but the video itself may load. `sandbox` without
 * allow-same-origin gives the page an opaque origin. `allow-scripts` is required only because a bare
 * sandbox also sets the "sandboxed automatic features" flag (which blocks autoplay) and forces native
 * controls; no script can run anyway, since `default-src 'none'` covers script-src. Works top-level
 * too (the app's Discover inspector opens it in a WKWebView).
 */
export const VIDEO_PREVIEW_CSP = "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox allow-scripts";
export const VIDEO_PREVIEW_RESPONSE_CSP = `${VIDEO_PREVIEW_CSP}; frame-ancestors 'self'`;

const PAGE_SIZE = 24;

function encodeCursor(parts: (string | number)[]): string {
  return btoa(JSON.stringify(parts)).replace(/=+$/, "");
}
function decodeCursor(c: string): unknown[] | null {
  try {
    const v = JSON.parse(atob(c));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * `limit`: absent or empty = a full page; otherwise a whole number, clamped to 1..PAGE_SIZE
 * (0 keeps the old "full page" meaning). Anything else ("1.5", "abc", "1e3", "-2") is a 400.
 */
export function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === "") return PAGE_SIZE;
  if (!/^\d{1,6}$/.test(raw.trim())) throw new HttpError(400, "invalid_limit", "limit must be a whole number.");
  const n = Number(raw.trim());
  return n === 0 ? PAGE_SIZE : Math.min(PAGE_SIZE, n);
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export interface ListResult {
  items: ReturnType<typeof toSummary>[];
  next: string | null;
}

/**
 * App builds released before video support send no `kind` and can only install HTML (they verify
 * manifest v1 only). URLSession's default User-Agent starts with "<CFBundleName>/", so those builds
 * get HTML-only lists. Newer apps send `kind=all` explicitly; the website never sends this UA.
 */
const LEGACY_APP_UA = /^MacWallpaperPro\//;

export async function listWallpapers(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (!params.has("kind") && LEGACY_APP_UA.test(request.headers.get("User-Agent") || "")) params.set("kind", "html");
  const result = await queryWallpapers(env, params);
  return json(result, 200, { "Cache-Control": "public, max-age=30", Vary: "User-Agent" });
}

/** Shared by the JSON API and the server-rendered pages. */
export async function queryWallpapers(env: Env, params: URLSearchParams): Promise<ListResult> {
  const url = { searchParams: params };
  const sort = url.searchParams.get("sort") === "popular" ? "popular" : "new";
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const tag = (url.searchParams.get("tag") || "").trim().toLowerCase().slice(0, 24);
  const categoryRaw = (url.searchParams.get("category") || "").trim().toLowerCase();
  const category = categoryRaw && categoryRaw !== "all" ? categoryRaw : "";
  if (category && !isCategory(category)) throw new HttpError(400, "invalid_category", "Unknown category.");
  const kindRaw = (url.searchParams.get("kind") || "").trim().toLowerCase();
  const kind = kindRaw && kindRaw !== "all" ? kindRaw : "";
  if (kind && !isKind(kind)) throw new HttpError(400, "invalid_kind", "kind must be html, video or all.");
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursorRaw = url.searchParams.get("cursor");

  const where = ["w.status = 'approved'"];
  const binds: (string | number)[] = [];
  if (q) {
    where.push("(w.title LIKE ? ESCAPE '\\' OR w.description LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')");
    const like = `%${likeEscape(q)}%`;
    binds.push(like, like, like);
  }
  if (category) {
    where.push("w.category = ?");
    binds.push(category);
  }
  if (kind) {
    where.push("w.kind = ?");
    binds.push(kind);
  }
  // Internal (landing page): leave out one category that has its own shelf.
  const exclude = (url.searchParams.get("exclude") || "").toLowerCase();
  if (exclude && isCategory(exclude)) {
    where.push("w.category <> ?");
    binds.push(exclude);
  }
  if (tag) {
    where.push("w.tags LIKE ? ESCAPE '\\'");
    binds.push(`%,${likeEscape(tag)},%`);
  }
  if (cursorRaw) {
    const c = decodeCursor(cursorRaw);
    const badCursor = () => new HttpError(400, "invalid_cursor", "Invalid cursor.");
    if (!c || c.length !== 2 || typeof c[1] !== "string" || c[1].length > 64) throw badCursor();
    if (sort === "popular") {
      const n = typeof c[0] === "number" ? c[0] : typeof c[0] === "string" && /^\d{1,15}$/.test(c[0]) ? Number(c[0]) : NaN;
      if (!Number.isSafeInteger(n) || n < 0) throw badCursor();
      where.push("(w.downloads < ? OR (w.downloads = ? AND w.id < ?))");
      binds.push(n, n, c[1]);
    } else {
      if (typeof c[0] !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]{1,20}Z$/.test(c[0])) throw badCursor();
      where.push("(w.created_at < ? OR (w.created_at = ? AND w.id < ?))");
      binds.push(c[0], c[0], c[1]);
    }
  }
  const order = sort === "popular" ? "w.downloads DESC, w.id DESC" : "w.created_at DESC, w.id DESC";
  const { results } = await env.DB.prepare(`${WP_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit + 1}`)
    .bind(...binds)
    .all<WallpaperRow>();
  const rows = results.slice(0, limit);
  let next: string | null = null;
  if (results.length > limit) {
    const last = rows[rows.length - 1];
    next = encodeCursor(sort === "popular" ? [last.downloads, last.id] : [last.created_at, last.id]);
  }
  return { items: rows.map(toSummary), next };
}

export async function listCategories(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.id, COUNT(w.id) AS count FROM categories c
     LEFT JOIN wallpapers w ON w.category = c.id AND w.status = 'approved'
     GROUP BY c.id ORDER BY c.sort_order`,
  ).all<{ id: string; count: number }>();
  const byId = new Map(results.map((r) => [r.id, r.count]));
  return json({ items: CATEGORIES.map((id) => ({ id, count: byId.get(id) ?? 0 })) }, 200, { "Cache-Control": "public, max-age=60" });
}

export async function loadWallpaper(env: Env, id: string): Promise<WallpaperRow | null> {
  return env.DB.prepare(`${WP_SELECT} WHERE w.id = ?`).bind(id).first<WallpaperRow>();
}

const notFound = () => new HttpError(404, "not_found", "Wallpaper not found.");

/** Load a wallpaper the caller is allowed to see (approved, or owner/admin). */
async function loadVisible(request: Request, env: Env, id: string) {
  const row = await loadWallpaper(env, id);
  if (!row) throw notFound();
  if (row.status === "approved") return { row, user: null };
  // Unpublished: only the owner or an admin (the session is looked up only in this case).
  const user = (await getAuth(request, env))?.user ?? null;
  if (!canSeeUnpublished(user, row)) throw notFound();
  return { row, user };
}

export async function getWallpaper(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await loadVisible(request, env, id);
  return json(toDetail(row), 200, row.status === "approved" ? { "Cache-Control": "public, max-age=30" } : {});
}

export async function getManifest(env: Env, id: string): Promise<Response> {
  const row = await loadWallpaper(env, id);
  if (!row || row.status !== "approved" || row.draft) throw notFound();
  const manifest = await signManifest(env, {
    kind: row.kind === "video" ? "video" : "html",
    id: row.id,
    version: row.version,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    title: row.title,
    author: row.author_name,
  });
  return json(manifest);
}

export async function getThumb(request: Request, env: Env, id: string): Promise<Response> {
  const { row } = await loadVisible(request, env, id);
  const obj = await env.BUCKET.get(row.thumb_key);
  if (!obj) throw notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": row.thumb_type,
      "Content-Length": String(obj.size),
      "Cache-Control": row.status === "approved" ? "public, max-age=3600" : "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ...SECURITY_HEADERS,
    },
  });
}

export async function getPreview(request: Request, env: Env, id: string): Promise<Response> {
  let row: WallpaperRow;
  try {
    ({ row } = await loadVisible(request, env, id));
  } catch (e) {
    if (e instanceof HttpError) {
      return new Response("Not found", { status: e.status, headers: { "Content-Type": "text/plain; charset=utf-8", ...PREVIEW_HEADERS } });
    }
    throw e;
  }
  if (row.kind === "video") return videoPreview(row);
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": row.status === "approved" ? "public, max-age=300" : "private, no-store",
      ...PREVIEW_HEADERS,
    },
  });
}

/** Tiny full-bleed player page; no script, no network except the video from this origin. */
export function videoPreviewHtml(id: string): string {
  const src = `/api/wallpapers/${encodeURIComponent(id)}/download`;
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover}</style>" +
    `</head><body><video autoplay loop muted playsinline preload="auto" src="${src}"></video></body></html>`
  );
}

function videoPreview(row: WallpaperRow): Response {
  return new Response(videoPreviewHtml(row.id), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": row.status === "approved" ? "public, max-age=300" : "private, no-store",
      ...PREVIEW_HEADERS,
      "Content-Security-Policy": VIDEO_PREVIEW_RESPONSE_CSP,
    },
  });
}

/**
 * Empty sandboxed shell used by the upload page to preview a local file before it is submitted.
 * The parent posts the HTML in; it is written into this opaque-origin document, so it runs under
 * exactly the same PREVIEW_CSP as published wallpapers (no network, no access to the site).
 * Only the framing page itself may feed it: the message must come from `parent` (never this window,
 * so a top-level open does nothing) and from this site's origin. frame-ancestors 'self' stops other
 * sites from framing it at all.
 */
export function previewShell(origin: string): string {
  const o = JSON.stringify(origin).replace(/</g, "\\u003c");
  return (
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}</style></head><body>' +
    `<script>(function(){var O=${o};if(parent===window)return;function h(e){if(e.source!==parent||e.origin!==O)return;` +
    "var d=e.data;if(!d||typeof d.html!=='string')return;removeEventListener('message',h);" +
    "document.open();document.write(d.html);document.close();}addEventListener('message',h);" +
    "parent.postMessage({mwpPreviewReady:true},O);})();</script></body></html>"
  );
}

export function previewSandbox(request: Request): Response {
  return new Response(previewShell(new URL(request.url).origin), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", ...PREVIEW_HEADERS },
  });
}

/** Free for everyone: no account, no entitlement check. Unpublished items only for owner/admin. */
export async function downloadWallpaper(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const { row } = await loadVisible(request, env, id);
  if (row.kind === "video") return downloadVideo(request, env, ctx, row);
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw notFound();
  if (row.status === "approved") {
    background(ctx, recordInstall(env, request, row.id));
  }
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(obj.size),
      "Content-Disposition": 'attachment; filename="index.html"',
      "X-Content-SHA256": row.sha256,
      "Cache-Control": "private, no-store",
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * Parse a single-range `Range: bytes=…` header against a known size (multi-range is ignored, i.e.
 * the whole file is sent). Returns null for "no usable range", "unsatisfiable" for 416.
 */
export function parseRange(header: string | null, size: number): { offset: number; length: number } | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix <= 0 || size === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

/** video.mp4 with `video/mp4`, Range support (so <video> can seek) and the verified SHA-256. */
async function downloadVideo(request: Request, env: Env, ctx: ExecutionContext, row: WallpaperRow): Promise<Response> {
  if (row.draft) throw notFound();
  const size = row.size_bytes;
  const range = parseRange(request.headers.get("Range"), size);
  const base: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Disposition": 'inline; filename="video.mp4"',
    "X-Content-SHA256": row.sha256,
    // Approved videos are immutable per version: let the browser reuse hover/preview fetches.
    "Cache-Control": row.status === "approved" ? "private, max-age=3600" : "private, no-store",
    // No Cross-Origin-Resource-Policy: /preview/:id is sandboxed (opaque origin), so its <video>
    // request is cross-origin and CORP same-origin/same-site would make the browser drop the bytes.
    ...SECURITY_HEADERS,
  };
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  const obj = await env.BUCKET.get(row.file_key, range ? { range } : undefined);
  if (!obj) throw notFound();
  // Count real installs only: the app downloads the whole file; <video> previews send Range.
  if (!range && row.status === "approved") {
    background(ctx, recordInstall(env, request, row.id));
  }
  if (range) {
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...base,
        "Content-Length": String(range.length),
        "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
      },
    });
  }
  return new Response(obj.body, { headers: { ...base, "Content-Length": String(obj.size) } });
}
