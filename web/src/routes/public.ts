import { getAuth } from "../lib/auth";
import { HttpError, json, SECURITY_HEADERS } from "../lib/http";
import { signManifest } from "../lib/manifest";
import {
  canSeeUnpublished,
  hasPurchased,
  inLibrary,
  toDetail,
  toSummary,
  WP_SELECT,
  type WallpaperRow,
} from "../lib/wallpapers";

export const PREVIEW_CSP = "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'";

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

export async function listWallpapers(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "popular" ? "popular" : "new";
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const tag = (url.searchParams.get("tag") || "").trim().toLowerCase().slice(0, 24);
  const cursorRaw = url.searchParams.get("cursor");

  const where = ["w.status = 'approved'"];
  const binds: (string | number)[] = [];
  if (q) {
    where.push("(w.title LIKE ? ESCAPE '\\' OR w.description LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')");
    const like = `%${likeEscape(q)}%`;
    binds.push(like, like, like);
  }
  if (tag) {
    where.push("w.tags LIKE ? ESCAPE '\\'");
    binds.push(`%,${likeEscape(tag)},%`);
  }
  if (cursorRaw) {
    const c = decodeCursor(cursorRaw);
    if (!c || c.length !== 2) throw new HttpError(400, "invalid_cursor", "cursor ไม่ถูกต้อง");
    if (sort === "popular") {
      where.push("(w.downloads < ? OR (w.downloads = ? AND w.id < ?))");
      binds.push(Number(c[0]), Number(c[0]), String(c[1]));
    } else {
      where.push("(w.created_at < ? OR (w.created_at = ? AND w.id < ?))");
      binds.push(String(c[0]), String(c[0]), String(c[1]));
    }
  }
  const order = sort === "popular" ? "w.downloads DESC, w.id DESC" : "w.created_at DESC, w.id DESC";
  const { results } = await env.DB.prepare(`${WP_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${PAGE_SIZE + 1}`)
    .bind(...binds)
    .all<WallpaperRow>();
  const rows = results.slice(0, PAGE_SIZE);
  let next: string | null = null;
  if (results.length > PAGE_SIZE) {
    const last = rows[rows.length - 1];
    next = encodeCursor(sort === "popular" ? [last.downloads, last.id] : [last.created_at, last.id]);
  }
  return json({ items: rows.map(toSummary), next }, 200, { "Cache-Control": "public, max-age=30" });
}

export async function loadWallpaper(env: Env, id: string): Promise<WallpaperRow | null> {
  return env.DB.prepare(`${WP_SELECT} WHERE w.id = ?`).bind(id).first<WallpaperRow>();
}

const notFound = () => new HttpError(404, "not_found", "ไม่พบวอลเปเปอร์นี้");

/** Load a wallpaper the caller is allowed to see (approved, or owner/admin). */
async function loadVisible(request: Request, env: Env, id: string) {
  const row = await loadWallpaper(env, id);
  if (!row) throw notFound();
  const auth = await getAuth(request, env);
  const user = auth?.user ?? null;
  if (row.status !== "approved" && !canSeeUnpublished(user, row)) throw notFound();
  return { row, user };
}

export async function getWallpaper(request: Request, env: Env, id: string): Promise<Response> {
  const { row, user } = await loadVisible(request, env, id);
  let owned = false;
  if (user) {
    owned =
      user.id === row.owner_id ||
      (await hasPurchased(env, user.id, row.id)) ||
      (row.price_cents === 0 && (await inLibrary(env, user.id, row.id)));
  }
  return json(toDetail(row, owned));
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
      return new Response("Not found", {
        status: e.status,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Security-Policy": PREVIEW_CSP, ...SECURITY_HEADERS },
      });
    }
    throw e;
  }
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw notFound();
  return new Response(obj.body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": PREVIEW_CSP,
      "Cache-Control": row.status === "approved" ? "public, max-age=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}

export async function downloadWallpaper(request: Request, env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const { row, user } = await loadVisible(request, env, id);
  const privileged = canSeeUnpublished(user, row);
  if (row.price_cents > 0 && !privileged) {
    const paid = user ? await hasPurchased(env, user.id, row.id) : false;
    if (!paid) throw new HttpError(402, "payment_required", "ต้องซื้อวอลเปเปอร์นี้ก่อนดาวน์โหลด");
  }
  const obj = await env.BUCKET.get(row.file_key);
  if (!obj) throw notFound();

  if (row.status === "approved") {
    const stmts = [env.DB.prepare("UPDATE wallpapers SET downloads = downloads + 1 WHERE id = ?").bind(row.id)];
    if (user && row.price_cents === 0) {
      stmts.push(
        env.DB.prepare("INSERT OR IGNORE INTO library (user_id, wallpaper_id, source) VALUES (?, ?, 'free')").bind(user.id, row.id),
      );
    }
    ctx.waitUntil(env.DB.batch(stmts).then(() => undefined));
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
