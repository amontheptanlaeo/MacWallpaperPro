import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { base64ToBytes } from "../src/lib/crypto";
import { manifestMessage } from "../src/lib/manifest";
import { PREVIEW_CSP } from "../src/routes/public";
import { call, insertWallpaper, register } from "./helpers";

// Public key published in docs/ARCHITECTURE.md (raw 32 bytes, base64).
const CONTRACT_PUBLIC_KEY = "4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604=";

describe("download entitlement", () => {
  it("returns 402 payment_required for an unpaid paid item (anonymous and logged-in)", async () => {
    const owner = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 4900 });
    const anon = await call(`/api/wallpapers/${wp.id}/download`);
    expect(anon.status).toBe(402);
    expect(await anon.json()).toMatchObject({ error: { code: "payment_required" } });

    const buyer = await register();
    const res = await call(`/api/wallpapers/${wp.id}/download`, { cookie: buyer.cookie });
    expect(res.status).toBe(402);

    // A pending (unpaid) purchase is still not an entitlement.
    await env.DB.prepare(
      "INSERT INTO purchases (id, user_id, wallpaper_id, creator_id, amount_cents, fee_cents, status) VALUES ('p_pending', ?, ?, ?, 4900, 980, 'pending')",
    ).bind(buyer.id, wp.id, owner.id).run();
    expect((await call(`/api/wallpapers/${wp.id}/download`, { cookie: buyer.cookie })).status).toBe(402);
  });

  it("serves bytes + X-Content-SHA256 after purchase, to the owner, and for free items", async () => {
    const owner = await register();
    const paid = await insertWallpaper({ ownerId: owner.id, priceCents: 4900 });
    const buyer = await register();
    await env.DB.prepare(
      "INSERT INTO purchases (id, user_id, wallpaper_id, creator_id, amount_cents, fee_cents, status) VALUES (?, ?, ?, ?, 4900, 980, 'paid')",
    ).bind("p_" + paid.id, buyer.id, paid.id, owner.id).run();

    const res = await call(`/api/wallpapers/${paid.id}/download`, { cookie: buyer.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-SHA256")).toBe(paid.sha);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(paid.size);

    expect((await call(`/api/wallpapers/${paid.id}/download`, { cookie: owner.cookie })).status).toBe(200);

    const free = await insertWallpaper({ ownerId: owner.id, priceCents: 0 });
    const f = await call(`/api/wallpapers/${free.id}/download`);
    expect(f.status).toBe(200);
    expect(f.headers.get("X-Content-SHA256")).toBe(free.sha);
    await f.arrayBuffer();
  });

  it("hides pending wallpapers from the public (detail, download, manifest, preview)", async () => {
    const owner = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 0, status: "pending" });
    for (const p of [`/api/wallpapers/${wp.id}`, `/api/wallpapers/${wp.id}/download`, `/api/wallpapers/${wp.id}/manifest`, `/preview/${wp.id}`]) {
      const r = await call(p);
      expect(r.status, p).toBe(404);
      await r.arrayBuffer();
    }
    // owner can see their own pending item, but there is still no manifest until approved
    expect((await call(`/api/wallpapers/${wp.id}`, { cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/api/wallpapers/${wp.id}/manifest`, { cookie: owner.cookie })).status).toBe(404);
  });
});

describe("signed manifest", () => {
  it("verifies with the contract public key over the exact message format", async () => {
    const owner = await register(undefined, undefined, "ผู้สร้าง");
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 0 });
    const res = await call(`/api/wallpapers/${wp.id}/manifest`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as { id: string; version: number; sha256: string; sizeBytes: number; title: string; author: string; signature: string };
    expect(m).toMatchObject({ id: wp.id, version: 1, sha256: wp.sha, sizeBytes: wp.size, author: "ผู้สร้าง" });

    const msg = `macwallpaperpro-manifest-v1\n${wp.id}\n1\n${wp.sha}\n${wp.size}`;
    expect(manifestMessage(m)).toBe(msg);
    const pub = await crypto.subtle.importKey("raw", base64ToBytes(CONTRACT_PUBLIC_KEY), { name: "Ed25519" }, false, ["verify"]);
    const sig = base64ToBytes(m.signature);
    expect(sig.byteLength).toBe(64);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(msg))).toBe(true);
    // tampering with any field breaks the signature
    const tampered = `macwallpaperpro-manifest-v1\n${wp.id}\n1\n${"0".repeat(64)}\n${wp.size}`;
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(tampered))).toBe(false);
  });
});

describe("preview", () => {
  it("serves approved HTML with the sandbox CSP from the contract", async () => {
    const owner = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 0 });
    const res = await call(`/preview/${wp.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'",
    );
    expect(PREVIEW_CSP).toBe(res.headers.get("Content-Security-Policy"));
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toContain("<html");
  });
});

describe("listing and detail", () => {
  it("lists approved items with contract-shaped summaries", async () => {
    const owner = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 2500 });
    const res = await call("/api/wallpapers?sort=new&tag=test");
    const body = (await res.json()) as { items: Record<string, unknown>[]; next: string | null };
    const item = body.items.find((i) => i.id === wp.id)!;
    expect(item).toMatchObject({ priceCents: 2500, currency: "thb", tags: ["test"], thumbUrl: `/api/wallpapers/${wp.id}/thumb` });
    expect(Object.keys(item).sort()).toEqual(["author", "createdAt", "currency", "downloads", "id", "priceCents", "tags", "thumbUrl", "title"]);
    const d = (await (await call(`/api/wallpapers/${wp.id}`)).json()) as Record<string, unknown>;
    expect(d).toMatchObject({ id: wp.id, owned: false, status: "approved", version: 1, sha256: wp.sha, sizeBytes: wp.size });
  });
});

describe("checkout without Stripe configured", () => {
  it("fails gracefully with stripe_not_configured", async () => {
    const owner = await register();
    const wp = await insertWallpaper({ ownerId: owner.id, priceCents: 4900 });
    const buyer = await register();
    const res = await call(`/api/wallpapers/${wp.id}/checkout`, { method: "POST", cookie: buyer.cookie });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "stripe_not_configured" } });
    const ob = await call("/api/creator/onboard", { method: "POST", cookie: owner.cookie });
    expect(ob.status).toBe(503);
  });
});
