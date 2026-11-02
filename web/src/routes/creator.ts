import { clearSessionCookies, requireAuth } from "../lib/auth";
import { randomId, sha256Hex } from "../lib/crypto";
import { HttpError, json, readJson } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import {
  isSha256Hex,
  MAX_UPLOAD_BODY,
  MAX_VIDEO_BYTES,
  normalizeTags,
  scanHtml,
  sniffVideo,
  validateHtml,
  validateMeta,
  validateThumb,
  validateVideoMeta,
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

  const kind = (fieldStr(form, "kind") || "html").trim().toLowerCase();
  if (kind === "video") return createVideoDraft(env, user.id, form, meta, tags);
  if (kind !== "html") throw new HttpError(400, "invalid_kind", "kind must be html or video.");

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

/**
 * Video step 1: metadata + thumbnail (a small multipart POST). The row is a hidden draft until
 * step 2 (PUT /api/uploads/:id/video) stores the verified bytes.
 */
async function createVideoDraft(
  env: Env,
  userId: string,
  form: FormData,
  meta: { title: string; description: string; category: string },
  tags: string[],
): Promise<Response> {
  const attribution = validateVideoMeta({
    credit: fieldStr(form, "credit"),
    license: fieldStr(form, "license"),
    sourceUrl: fieldStr(form, "sourceUrl"),
    rights: fieldStr(form, "rights"),
  });
  const thumb = await fileBytes(form, "thumb");
  if (!thumb) throw new HttpError(400, "invalid_thumb", "Attach a thumbnail.");
  const thumbType = validateThumb(thumb);

  const id = randomId(14);
  const version = 1;
  const fileKey = `wallpapers/${id}/v${version}/video.mp4`;
  const thumbKey = `wallpapers/${id}/thumb`;
  await env.BUCKET.put(thumbKey, thumb, { httpMetadata: { contentType: thumbType } });
  await env.DB.prepare(
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes,
       file_key, thumb_key, thumb_type, scan_flags, kind, credit, license, source_url, draft)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, '', 0, ?, ?, ?, '[]', 'video', ?, ?, ?, 1)`,
  )
    .bind(
      id,
      userId,
      meta.title,
      meta.description,
      tags.length ? `,${tags.join(",")},` : "",
      meta.category,
      version,
      fileKey,
      thumbKey,
      thumbType,
      attribution.credit,
      attribution.license,
      attribution.sourceUrl,
    )
    .run();
  return json({ id, status: "draft", uploadUrl: `/api/uploads/${id}/video` }, 201);
}

/**
 * Video step 2: raw bytes, streamed straight into R2 (free plan: ~10 ms CPU, so the Worker never
 * hashes or buffers the file). The uploader declares the SHA-256 in X-Content-SHA256 and R2
 * verifies it server-side, rejecting the write on mismatch. Only the first chunk is inspected (the
 * MP4/MOV "ftyp" box); a FixedLengthStream enforces the declared Content-Length.
 */
export async function uploadVideo(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  await rateLimit(env, `video:${user.id}`, LIMITS.videoPut);

  const lenHeader = request.headers.get("Content-Length");
  if (!lenHeader || !/^\d+$/.test(lenHeader)) throw new HttpError(411, "length_required", "Send the video with a Content-Length header.");
  const len = Number(lenHeader);
  if (len > MAX_VIDEO_BYTES) throw new HttpError(413, "file_too_large", "The video must be 60 MB or smaller.");
  if (len < 12) throw new HttpError(400, "invalid_video", "This is not an MP4 or MOV video.");
  const sha256 = (request.headers.get("X-Content-SHA256") || "").trim().toLowerCase();
  if (!isSha256Hex(sha256)) throw new HttpError(400, "invalid_sha256", "Send the file's SHA-256 (64 lowercase hex characters) in X-Content-SHA256.");

  const row = await env.DB.prepare(`${WP_SELECT} WHERE w.id = ?`).bind(id).first<WallpaperRow>();
  if (!row || row.owner_id !== user.id || row.kind !== "video") throw new HttpError(404, "not_found", "Upload not found.");
  if (!row.draft) throw new HttpError(409, "already_uploaded", "This video has already been uploaded.");
  if (!request.body) throw new HttpError(400, "invalid_video", "This is not an MP4 or MOV video.");

  // Peek at the first bytes without buffering the body.
  const reader = request.body.getReader();
  const head: Uint8Array[] = [];
  let got = 0;
  while (got < 12) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.byteLength) {
      head.push(value);
      got += value.byteLength;
    }
  }
  const first = new Uint8Array(Math.min(got, 12));
  let off = 0;
  for (const c of head) {
    if (off >= first.length) break;
    const take = c.subarray(0, first.length - off);
    first.set(take, off);
    off += take.byteLength;
  }
  if (!sniffVideo(first)) {
    await reader.cancel().catch(() => {});
    throw new HttpError(400, "invalid_video", "This is not an MP4 or MOV video (no ftyp box).");
  }
  reader.releaseLock();

  // Replay the peeked chunks, then pipe the rest natively; R2 needs a known length.
  const { readable, writable } = new FixedLengthStream(len);
  const body = request.body;
  const pump = (async () => {
    const w = writable.getWriter();
    for (const c of head) await w.write(c);
    w.releaseLock();
    await body.pipeTo(writable);
  })();
  const put = env.BUCKET.put(row.file_key, readable, {
    sha256,
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: { owner: user.id },
  });
  const [p, q] = await Promise.allSettled([put, pump]);
  if (p.status === "rejected" || q.status === "rejected" || !p.value) {
    const msg = String((p.status === "rejected" ? p.reason : q.status === "rejected" ? q.reason : "") ?? "");
    console.warn(JSON.stringify({ msg: "video_put_failed", id, error: msg.slice(0, 200) }));
    await env.BUCKET.delete(row.file_key).catch(() => {});
    if (/sha-?256|checksum|digest/i.test(msg))
      throw new HttpError(400, "hash_mismatch", "The uploaded bytes don't match X-Content-SHA256. Try again.");
    throw new HttpError(400, "upload_incomplete", "The upload ended early or didn't match Content-Length. Try again.");
  }

  // R2 verified the bytes, so the declared hash is now the file's real hash.
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE wallpapers SET draft = 0, sha256 = ?, size_bytes = ?, updated_at = ? WHERE id = ? AND draft = 1")
    .bind(sha256, len, now, id)
    .run();
  return json({ id, status: "pending" }, 201);
}

export async function myWallpapers(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const { results } = await env.DB.prepare(`${WP_SELECT} WHERE w.owner_id = ? AND w.draft = 0 ORDER BY w.created_at DESC`)
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


/**
 * Self-service "Delete my account": removes the user, their sign-in identities and sessions, and
 * every wallpaper they uploaded (D1 rows and R2 objects, published ones included). The Origin check
 * runs in the router for every non-GET request; the body must also carry {"confirm": "DELETE"} so a
 * stray or replayed request can't trigger it. Anonymous aggregate stats are not personal data and stay.
 */
export async function deleteAccount(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson(request);
  if (body.confirm !== "DELETE") throw new HttpError(400, "confirm_required", 'Send {"confirm": "DELETE"} to delete your account.');

  const { results } = await env.DB.prepare("SELECT id, file_key, thumb_key FROM wallpapers WHERE owner_id = ?")
    .bind(user.id)
    .all<{ id: string; file_key: string; thumb_key: string }>();
  // R2 first: if this fails, nothing is deleted from D1 and the user can simply retry.
  const keys = results.flatMap((r) => [r.file_key, r.thumb_key]);
  for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));

  await env.DB.batch([
    env.DB.prepare("DELETE FROM wallpapers WHERE owner_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM identities WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM rate_limits WHERE key IN (?, ?)").bind(`upload:${user.id}`, `video:${user.id}`),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  console.log(JSON.stringify({ msg: "account_deleted", wallpapers: results.length }));
  const res = json({ ok: true, deletedWallpapers: results.length });
  for (const c of clearSessionCookies(request)) res.headers.append("Set-Cookie", c);
  return res;
}
