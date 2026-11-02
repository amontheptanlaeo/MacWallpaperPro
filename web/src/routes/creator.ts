import { requireAuth } from "../lib/auth";
import { randomId, sha256Hex } from "../lib/crypto";
import { HttpError, json } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import { createOnboardingLink, createRecipientAccount, requireStripe, retrieveAccount, transfersActive } from "../lib/stripe";
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
  if (len > MAX_UPLOAD_BODY) throw new HttpError(413, "payload_too_large", "ไฟล์รวมกันใหญ่เกินไป (index.html ≤ 10 MB, ภาพปก ≤ 2 MB)");
  const ctype = request.headers.get("Content-Type") || "";
  if (!ctype.toLowerCase().startsWith("multipart/form-data"))
    throw new HttpError(415, "unsupported_media_type", "ต้องส่งแบบ multipart/form-data");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "invalid_form", "อ่านข้อมูลฟอร์มไม่ได้");
  }

  const meta = validateMeta({
    title: fieldStr(form, "title"),
    description: fieldStr(form, "description"),
    price: fieldStr(form, "price_cents"),
  });
  const tags = normalizeTags(fieldStr(form, "tags"));

  const html = await fileBytes(form, "file");
  if (!html) throw new HttpError(400, "invalid_file", "กรุณาแนบไฟล์ index.html");
  const text = validateHtml(html);
  const thumb = await fileBytes(form, "thumb");
  if (!thumb) throw new HttpError(400, "invalid_thumb", "กรุณาแนบภาพปก");
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
    `INSERT INTO wallpapers (id, owner_id, title, description, tags, price_cents, status, version, sha256, size_bytes,
       file_key, thumb_key, thumb_type, scan_flags)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      meta.title,
      meta.description,
      tags.length ? `,${tags.join(",")},` : "",
      meta.priceCents,
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
      ...toDetail(r, true),
      rejectReason: r.reject_reason,
      scanFlagCount: parseScan(r.scan_flags).length,
    })),
  );
}

export async function onboard(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  requireStripe(env);
  let accountId = user.stripeAccountId;
  if (!accountId) {
    const acct = await createRecipientAccount(env, user);
    accountId = acct.id;
    await env.DB.prepare("UPDATE users SET stripe_account_id = ? WHERE id = ? AND stripe_account_id IS NULL")
      .bind(accountId, user.id)
      .run();
  }
  const origin = new URL(request.url).origin;
  const link = await createOnboardingLink(
    env,
    accountId,
    `${origin}/community/earnings?onboarding=done`,
    `${origin}/community/earnings?onboarding=refresh`,
  );
  return json({ url: link.url });
}

export async function earnings(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);

  if (user.stripeAccountId && !user.payoutsEnabled && String(env.STRIPE_SECRET_KEY || "")) {
    try {
      if (transfersActive(await retrieveAccount(env, user.stripeAccountId))) {
        await env.DB.prepare("UPDATE users SET payouts_enabled = 1 WHERE id = ?").bind(user.id).run();
        user.payoutsEnabled = true;
      }
    } catch {
      /* show cached status */
    }
  }

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS sales, COALESCE(SUM(amount_cents),0) AS gross, COALESCE(SUM(fee_cents),0) AS fees
     FROM purchases WHERE creator_id = ? AND status = 'paid'`,
  )
    .bind(user.id)
    .first<{ sales: number; gross: number; fees: number }>();
  const { results: perItem } = await env.DB.prepare(
    `SELECT w.id, w.title, w.price_cents, w.downloads,
            COUNT(p.id) AS sales, COALESCE(SUM(p.amount_cents),0) AS gross, COALESCE(SUM(p.fee_cents),0) AS fees
     FROM wallpapers w LEFT JOIN purchases p ON p.wallpaper_id = w.id AND p.status = 'paid'
     WHERE w.owner_id = ? GROUP BY w.id ORDER BY gross DESC, w.created_at DESC`,
  )
    .bind(user.id)
    .all<{ id: string; title: string; price_cents: number; downloads: number; sales: number; gross: number; fees: number }>();
  const { results: recent } = await env.DB.prepare(
    `SELECT p.id, p.wallpaper_id, w.title, p.amount_cents, p.fee_cents, p.paid_at
     FROM purchases p JOIN wallpapers w ON w.id = p.wallpaper_id
     WHERE p.creator_id = ? AND p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ id: string; wallpaper_id: string; title: string; amount_cents: number; fee_cents: number; paid_at: string }>();

  const t = totals ?? { sales: 0, gross: 0, fees: 0 };
  return json({
    currency: "thb",
    feePercent: Number(env.PLATFORM_FEE_PERCENT ?? 20),
    stripeConfigured: !!String(env.STRIPE_SECRET_KEY || ""),
    creator: { connected: !!user.stripeAccountId, payoutsEnabled: user.payoutsEnabled },
    totals: { salesCount: t.sales, grossCents: t.gross, feeCents: t.fees, netCents: t.gross - t.fees },
    items: perItem.map((r) => ({
      wallpaperId: r.id,
      title: r.title,
      priceCents: r.price_cents,
      downloads: r.downloads,
      salesCount: r.sales,
      grossCents: r.gross,
      netCents: r.gross - r.fees,
    })),
    recent: recent.map((r) => ({
      purchaseId: r.id,
      wallpaperId: r.wallpaper_id,
      title: r.title,
      amountCents: r.amount_cents,
      netCents: r.amount_cents - r.fee_cents,
      paidAt: r.paid_at,
    })),
  });
}
