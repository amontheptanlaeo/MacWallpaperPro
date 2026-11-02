import { requireAuth } from "../lib/auth";
import { HttpError, json } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";
import {
  createCheckoutSession,
  newPurchaseId,
  platformFee,
  requireStripe,
  retrieveAccount,
  transfersActive,
  verifyStripeSignature,
} from "../lib/stripe";
import { hasPurchased, toSummary, WP_SELECT, type WallpaperRow } from "../lib/wallpapers";
import { loadWallpaper } from "./public";

export async function checkout(request: Request, env: Env, id: string): Promise<Response> {
  const { user } = await requireAuth(request, env);
  requireStripe(env);
  await rateLimit(env, `checkout:${user.id}`, LIMITS.checkout);

  const wp = await loadWallpaper(env, id);
  if (!wp || wp.status !== "approved") throw new HttpError(404, "not_found", "ไม่พบวอลเปเปอร์นี้");
  if (wp.price_cents === 0) throw new HttpError(400, "free_item", "วอลเปเปอร์นี้ฟรี ดาวน์โหลดได้เลย");
  if (wp.owner_id === user.id) throw new HttpError(400, "own_item", "นี่คือวอลเปเปอร์ของคุณเอง");
  if (await hasPurchased(env, user.id, wp.id)) throw new HttpError(409, "already_owned", "คุณซื้อวอลเปเปอร์นี้แล้ว");

  const creator = await env.DB.prepare("SELECT stripe_account_id, payouts_enabled FROM users WHERE id = ?")
    .bind(wp.owner_id)
    .first<{ stripe_account_id: string | null; payouts_enabled: number }>();
  if (!creator?.stripe_account_id) throw new HttpError(409, "creator_not_ready", "ผู้สร้างยังไม่ได้ผูกบัญชีรับเงิน จึงยังขายไม่ได้");
  if (!creator.payouts_enabled) {
    // Re-check capability right before charging.
    const acct = await retrieveAccount(env, creator.stripe_account_id);
    if (!transfersActive(acct)) throw new HttpError(409, "creator_not_ready", "บัญชีรับเงินของผู้สร้างยังยืนยันตัวตนไม่เสร็จ");
    await env.DB.prepare("UPDATE users SET payouts_enabled = 1 WHERE id = ?").bind(wp.owner_id).run();
  }

  const purchaseId = newPurchaseId();
  const fee = platformFee(env, wp.price_cents);
  const origin = new URL(request.url).origin;
  await env.DB.prepare(
    `INSERT INTO purchases (id, user_id, wallpaper_id, creator_id, amount_cents, fee_cents, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
  )
    .bind(purchaseId, user.id, wp.id, wp.owner_id, wp.price_cents, fee)
    .run();

  const session = await createCheckoutSession(env, {
    purchaseId,
    userId: user.id,
    email: user.email,
    wallpaperId: wp.id,
    title: wp.title,
    amountCents: wp.price_cents,
    feeCents: fee,
    destination: creator.stripe_account_id,
    successUrl: `${origin}/community/w/${wp.id}?purchase=success`,
    cancelUrl: `${origin}/community/w/${wp.id}?purchase=cancelled`,
  });
  await env.DB.prepare("UPDATE purchases SET stripe_session_id = ? WHERE id = ?").bind(session.id, purchaseId).run();
  return json({ url: session.url });
}

export async function library(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const { results } = await env.DB.prepare(
    `${WP_SELECT} JOIN library l ON l.wallpaper_id = w.id WHERE l.user_id = ? ORDER BY l.added_at DESC`,
  )
    .bind(user.id)
    .all<WallpaperRow>();
  return json(results.map(toSummary));
}

interface CheckoutSessionObject {
  id: string;
  payment_status?: string;
  payment_intent?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
}
interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  const secret = String(env.STRIPE_WEBHOOK_SECRET || "");
  if (!secret) throw new HttpError(503, "stripe_not_configured", "ยังไม่ได้ตั้งค่า STRIPE_WEBHOOK_SECRET");
  const payload = await request.text();
  if (payload.length > 512 * 1024) throw new HttpError(413, "payload_too_large", "payload too large");
  const ok = await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), secret);
  if (!ok) throw new HttpError(400, "invalid_signature", "Stripe-Signature ไม่ถูกต้อง");

  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    throw new HttpError(400, "invalid_json", "invalid JSON");
  }
  if (!event?.id || !event.type) throw new HttpError(400, "invalid_event", "invalid event");

  const seen = await env.DB.prepare("SELECT 1 FROM stripe_events WHERE id = ?").bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });

  const now = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [];
  const obj = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = obj as unknown as CheckoutSessionObject;
      if (s.payment_status === "unpaid") break; // async methods: wait for async_payment_succeeded
      const purchaseId = s.client_reference_id || s.metadata?.purchase_id;
      if (!purchaseId) break;
      stmts.push(
        env.DB.prepare(
          `UPDATE purchases SET status = 'paid', paid_at = COALESCE(paid_at, ?), stripe_payment_intent = COALESCE(?, stripe_payment_intent),
             stripe_session_id = COALESCE(stripe_session_id, ?) WHERE id = ? AND status IN ('pending', 'failed')`,
        ).bind(now, s.payment_intent ?? null, s.id, purchaseId),
        env.DB.prepare(
          `INSERT INTO library (user_id, wallpaper_id, source)
             SELECT user_id, wallpaper_id, 'purchase' FROM purchases WHERE id = ? AND status = 'paid'
           ON CONFLICT(user_id, wallpaper_id) DO UPDATE SET source = 'purchase'`,
        ).bind(purchaseId),
      );
      break;
    }
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const s = obj as unknown as CheckoutSessionObject;
      const purchaseId = s.client_reference_id || s.metadata?.purchase_id;
      if (purchaseId)
        stmts.push(env.DB.prepare("UPDATE purchases SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(purchaseId));
      break;
    }
    case "charge.refunded": {
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      if (pi && obj.refunded === true) {
        stmts.push(env.DB.prepare("UPDATE purchases SET status = 'refunded' WHERE stripe_payment_intent = ?").bind(pi));
        stmts.push(
          env.DB.prepare(
            `DELETE FROM library WHERE source = 'purchase' AND EXISTS (
               SELECT 1 FROM purchases p WHERE p.stripe_payment_intent = ? AND p.user_id = library.user_id AND p.wallpaper_id = library.wallpaper_id)`,
          ).bind(pi),
        );
      }
      break;
    }
    default:
      break; // acknowledged but ignored
  }

  // Record the event in the same atomic batch so a retry after a partial failure re-processes cleanly.
  stmts.push(env.DB.prepare("INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)").bind(event.id, event.type));
  await env.DB.batch(stmts);
  return json({ received: true });
}
