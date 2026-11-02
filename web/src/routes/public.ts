import { getAuth } from "../lib/auth";
import { HttpError, json, SECURITY_HEADERS } from "../lib/http";
import { signManifest } from "../lib/manifest";
import { CATEGORIES, isCategory } from "../lib/validate";
import { canSeeUnpublished, toDetail, toSummary, WP_SELECT, type WallpaperRow } from "../lib/wallpapers";

/**
 * Locked-down policy for wallpaper HTML (docs/ARCHITECTURE.md). `sandbox allow-scripts` without
 * allow-same-origin gives the document an opaque origin even when opened top-level (the app's
 * inspector does that), and connect-src 'none' blocks fetch/XHR/WebSocket/beacons.
 */
export const PREVIEW_CSP = "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'";

const PREVIEW_HEADERS = {
  "Content-Security-Policy": PREVIEW_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=()",
};

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

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export interface ListResult {
  items: ReturnType<typeof toSummary>[];
  next: string | null;
}

export async function listWallpapers(request: Request, env: Env): Promise<Response> {
  const result = await queryWallpapers(env, new URL(request.url).searchParams);
  return json(result, 200, { "Cache-Control": "public, max-age=30" });
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
  const limit = Math.min(PAGE_SIZE, Math.max(1, Number(url.searchParams.get("limit")) || PAGE_SIZE));
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
    if (!c || c.length !== 2) throw new HttpError(400, "invalid_cursor", "Invalid cursor.");
    if (sort === "popular") {
      where.push("(w.downloads < ? OR (w.downloads = ? AND w.id < ?))");
      binds.push(Number(c[0]), Number(c[0]), String(c[1]));
    } else {
      where.push("(w.created_at < ? OR (w.created_at = ? AND w.id < ?))");
      binds.push(String(c[0]), String(c[0]), String(c[1]));
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
  if (!row || row.status !== "approved") throw notFound();
  const manifest = await signManifest(env, {
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

/**
 * Empty sandboxed shell used by the upload page to preview a local file before it is submitted.
 * The parent posts the HTML in; it is written into this opaque-origin document, so it runs under
 * exactly the same PREVIEW_CSP as published wallpapers (no network, no access to the site).
 */
export const PREVIEW_SHELL =
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}</style></head><body>' +
  "<script>addEventListener('message',function(e){var d=e.data;if(!d||typeof d.html!=='string')return;" +
  "document.open();document.write(d.html);document.close();},{once:true});parent.postMessage({mwpPreviewReady:true},'*');</script></body></html>";

export function previewSandbox(): Response {
  return new Response(PREVIEW_SHELL, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", ...PREVIEW_HEADERS },
  });
}

/** Free for everyone: no account, no entitlement check. Unpublished items only for owner/admin. */
export async function downloadWallpaper(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const { row } = await loadVisible(request, env, id);
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw notFound();
  if (row.status === "approved") {
    ctx.waitUntil(env.DB.prepare("UPDATE wallpapers SET downloads = downloads + 1 WHERE id = ?").bind(row.id).run().then(() => undefined));
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
