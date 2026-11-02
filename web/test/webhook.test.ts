import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../src/lib/crypto";
import { call, insertWallpaper, register } from "./helpers";

const SECRET = "whsec_test_secret";

async function signed(payload: string, t = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `t=${t},v1=${await hmacSha256Hex(secret, `${t}.${payload}`)}`;
}

function post(payload: string, sig?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sig) headers["Stripe-Signature"] = sig;
  // Stripe sends no Origin; the webhook must not depend on it.
  return call("/api/stripe/webhook", { method: "POST", body: payload, headers, noOrigin: true });
}

describe("stripe webhook", () => {
  const evt = JSON.stringify({ id: "evt_reject", type: "checkout.session.completed", data: { object: { id: "cs_x", payment_status: "paid", client_reference_id: "nope" } } });

  it("rejects missing signatures", async () => {
    const r = await post(evt);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { code: "invalid_signature" } });
  });

  it("rejects signatures made with the wrong secret", async () => {
    expect((await post(evt, await signed(evt, undefined, "whsec_wrong"))).status).toBe(400);
  });

  it("rejects a valid signature over a different body", async () => {
    expect((await post(evt.replace("paid", "unpaid"), await signed(evt))).status).toBe(400);
  });

  it("rejects stale timestamps (replay)", async () => {
    expect((await post(evt, await signed(evt, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
  });

  it("fulfils a paid checkout once, idempotently by event.id", async () => {
    const owner = await register();
    const buyer = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 4900 });
    await env.DB.prepare(
      "INSERT INTO purchases (id, user_id, wallpaper_id, creator_id, amount_cents, fee_cents, status, stripe_session_id) VALUES ('pur_ok', ?, ?, ?, 4900, 980, 'pending', 'cs_ok')",
    ).bind(buyer.id, wp.id, owner.id).run();
    expect((await call(`/api/wallpapers/${wp.id}/download`, { cookie: buyer.cookie })).status).toBe(402);

    const payload = JSON.stringify({
      id: "evt_ok_1",
      type: "checkout.session.completed",
      data: { object: { id: "cs_ok", payment_status: "paid", payment_intent: "pi_1", client_reference_id: "pur_ok" } },
    });
    const r1 = await post(payload, await signed(payload));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ received: true });
    const r2 = await post(payload, await signed(payload));
    expect(await r2.json()).toEqual({ received: true, duplicate: true });

    const dl = await call(`/api/wallpapers/${wp.id}/download`, { cookie: buyer.cookie });
    expect(dl.status).toBe(200);
    await dl.arrayBuffer();
    const lib = (await (await call("/api/me/library", { cookie: buyer.cookie })).json()) as { id: string }[];
    expect(lib.map((l) => l.id)).toContain(wp.id);

    const earn = (await (await call("/api/creator/earnings", { cookie: owner.cookie })).json()) as { totals: Record<string, number> };
    expect(earn.totals).toMatchObject({ salesCount: 1, grossCents: 4900, feeCents: 980, netCents: 3920 });
  });

  it("does not fulfil an unpaid (async) completed session", async () => {
    const owner = await register();
    const buyer = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 4900 });
    await env.DB.prepare(
      "INSERT INTO purchases (id, user_id, wallpaper_id, creator_id, amount_cents, fee_cents, status) VALUES ('pur_async', ?, ?, ?, 4900, 980, 'pending')",
    ).bind(buyer.id, wp.id, owner.id).run();
    const payload = JSON.stringify({ id: "evt_async", type: "checkout.session.completed", data: { object: { id: "cs_a", payment_status: "unpaid", client_reference_id: "pur_async" } } });
    expect((await post(payload, await signed(payload))).status).toBe(200);
    expect((await call(`/api/wallpapers/${wp.id}/download`, { cookie: buyer.cookie })).status).toBe(402);
  });
});
