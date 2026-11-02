// Minimal Stripe client over fetch (no SDK). v1 endpoints are form-encoded, v2 endpoints JSON.
import { HttpError } from "./http";
import { hmacSha256Hex, randomId, timingSafeEqualStr } from "./crypto";

const API = "https://api.stripe.com";
/** Tags our Checkout Sessions in the Stripe Dashboard (fixed label + 8 random letters). */
export const CHECKOUT_INTEGRATION_ID = "macwallpaperpro-store-qzkvmrta";

export function stripeConfigured(env: Env): boolean {
  return !!String(env.STRIPE_SECRET_KEY || "").trim();
}

export function requireStripe(env: Env): string {
  const key = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!key)
    throw new HttpError(
      503,
      "stripe_not_configured",
      "ระบบชำระเงินยังไม่เปิดใช้งานบนเซิร์ฟเวอร์นี้ (ยังไม่ได้ตั้งค่า STRIPE_SECRET_KEY) ส่วนอื่นของร้านใช้งานได้ตามปกติ",
    );
  return key;
}

/** Flatten nested objects into Stripe's bracket form encoding. */
export function formEncode(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") formEncode(item as Record<string, unknown>, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") formEncode(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

interface StripeErrorBody {
  error?: { message?: string; code?: string; type?: string };
}

async function call<T>(env: Env, method: string, path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = requireStripe(env);
  const isV2 = path.startsWith("/v2/");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": String(env.STRIPE_API_VERSION || "2026-09-30.endive"),
  };
  let payload: string | undefined;
  if (body) {
    if (isV2) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = formEncode(body).toString();
    }
  }
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: payload });
  const data = (await res.json().catch(() => ({}))) as T & StripeErrorBody;
  if (!res.ok) {
    console.error(JSON.stringify({ msg: "stripe_error", path, status: res.status, error: data.error }));
    throw new HttpError(502, "stripe_error", `Stripe ตอบกลับข้อผิดพลาด: ${data.error?.message ?? res.status}`);
  }
  return data;
}

// ---- Connect (Accounts v2, marketplace recipient configuration) ----

export interface V2Account {
  id: string;
  configuration?: {
    recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } } };
  };
}

export function createRecipientAccount(env: Env, user: { id: string; email: string; displayName: string }) {
  return call<V2Account>(
    env,
    "POST",
    "/v2/core/accounts",
    {
      contact_email: user.email,
      display_name: user.displayName,
      dashboard: "express",
      identity: { country: String(env.STRIPE_CONNECT_COUNTRY || "th").toLowerCase() },
      defaults: { responsibilities: { fees_collector: "application", losses_collector: "application" } },
      configuration: {
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      metadata: { user_id: user.id },
      include: ["configuration.recipient", "identity", "requirements"],
    },
    `acct-create-${user.id}`,
  );
}

export function retrieveAccount(env: Env, accountId: string) {
  return call<V2Account>(env, "GET", `/v2/core/accounts/${encodeURIComponent(accountId)}?include=configuration.recipient`);
}

export function transfersActive(acct: V2Account): boolean {
  return acct.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
}

export function createOnboardingLink(env: Env, accountId: string, returnUrl: string, refreshUrl: string) {
  return call<{ url: string }>(env, "POST", "/v2/core/account_links", {
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: { configurations: ["recipient"], return_url: returnUrl, refresh_url: refreshUrl },
    },
  });
}

// ---- Checkout (destination charge with application fee) ----

export function platformFee(env: Env, amountCents: number): number {
  const pct = Number(env.PLATFORM_FEE_PERCENT ?? 20);
  const p = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 20;
  return Math.round((amountCents * p) / 100);
}

export function createCheckoutSession(
  env: Env,
  p: {
    purchaseId: string;
    userId: string;
    email: string;
    wallpaperId: string;
    title: string;
    amountCents: number;
    feeCents: number;
    destination: string;
    successUrl: string;
    cancelUrl: string;
  },
) {
  return call<{ id: string; url: string }>(
    env,
    "POST",
    "/v1/checkout/sessions",
    {
      mode: "payment",
      integration_identifier: CHECKOUT_INTEGRATION_ID,
      customer_email: p.email,
      client_reference_id: p.purchaseId,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "thb", unit_amount: p.amountCents, product_data: { name: p.title } },
        },
      ],
      payment_intent_data: {
        application_fee_amount: p.feeCents,
        transfer_data: { destination: p.destination },
        metadata: { purchase_id: p.purchaseId, wallpaper_id: p.wallpaperId, user_id: p.userId },
      },
      metadata: { purchase_id: p.purchaseId, wallpaper_id: p.wallpaperId, user_id: p.userId },
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
    },
    `checkout-${p.purchaseId}`,
  );
}

// ---- Webhook signature (Stripe-Signature: t=...,v1=...) ----

export const WEBHOOK_TOLERANCE_SEC = 300;

export async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t") t = v ?? "";
    else if (k === "v1" && v) v1.push(v);
  }
  if (!/^\d+$/.test(t) || v1.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > WEBHOOK_TOLERANCE_SEC) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${payload}`);
  return v1.some((sig) => timingSafeEqualStr(sig, expected));
}

export function newPurchaseId(): string {
  return "pur_" + randomId(18);
}
