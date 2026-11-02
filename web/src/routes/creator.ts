import { requireAuth } from "../lib/auth";
import { randomId, sha256Hex } from "../lib/crypto";
import { HttpError, json } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import {
  MAX_UPLOAD_BODY,
  normalizeTags,
  scanHtml,
  validateHtml,
  validateMeta,
  validateThumb,
} from "../lib/validate";
import { parseScan, toDetail, WP_SELECT, type WallpaperRow } from "../lib/wallpapers";

function fieldStr(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

async function fileBytes(form: FormData, name: string): Promise<Uint8Array | null> {
  const v = form.get(name) as unknown;
  if (!v || typeof v === "string") return null;
  return new Uint8Array(await (v as Blob).arrayBuffer());
}

export async function uploadWallpaper(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  await rateLimit(env, `upload:${user.id}`, LIMITS.upload);

  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > MAX_UPLOAD_BODY) throw new HttpError(413, "payload_too_large", "Upload is too large (index.html ≤ 10 MB, thumbnail ≤ 2 MB).");
  const ctype = request.headers.get("Content-Type") || "";
  if (!ctype.toLowerCase().startsWith("multipart/form-data"))
    throw new HttpError(415, "unsupported_media_type", "Send multipart/form-data.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_form", "Could not read the form.");
  }

  const meta = validateMeta({
    title: fieldStr(form, "title"),
    description: fieldStr(form, "description"),
    category: fieldStr(form, "category"),
  });
  const tags = normalizeTags(fieldStr(form, "tags"));

  const html = await fileBytes(form, "file");
  if (!html) throw new HttpError(400, "invalid_file", "Attach index.html.");
  const text = validateHtml(html);
  const thumb = await fileBytes(form, "thumb");
  if (!thumb) throw new HttpError(400, "invalid_thumb", "Attach a thumbnail.");
  const thumbType = validateThumb(thumb);

  const id = randomId(14);
  const version = 1;
  const sha256 = await sha256Hex(html);
  const fileKey = `wallpapers/${id}/v${version}/index.html`;
  const thumbKey = `wallpapers/${id}/thumb`;
  const findings = scanHtml(text);

  await env.BUCKET.put(fileKey, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    sha256,
    customMetadata: { owner: user.id },
  });
  await env.BUCKET.put(thumbKey, thumb, { httpMetadata: { contentType: thumbType } });

  await env.DB.prepare(
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes,
       file_key, thumb_key, thumb_type, scan_flags)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      meta.title,
      meta.description,
      tags.length ? `,${tags.join(",")},` : "",
      meta.category,
      version,
      sha256,
      html.byteLength,
      fileKey,
      thumbKey,
      thumbType,
      JSON.stringify(findings),
    )
    .run();

  return json({ id, status: "pending" }, 201);
}

export async function myWallpapers(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const { results } = await env.DB.prepare(`${WP_SELECT} WHERE w.owner_id = ? ORDER BY w.created_at DESC`)
    .bind(user.id)
    .all<WallpaperRow>();
  return json(
    results.map((r) => ({
      ...toDetail(r),
      rejectReason: r.reject_reason,
      scanFlagCount: parseScan(r.scan_flags).length,
    })),
  );
}

