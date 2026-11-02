import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { base64ToBytes } from "../src/lib/crypto";
import { manifestMessage } from "../src/lib/manifest";
import { PREVIEW_CSP } from "../src/routes/public";
import { call, insertWallpaper, signedInUser, signingPublicKey } from "./helpers";

// Public key published in docs/ARCHITECTURE.md (raw 32 bytes, base64).
const CONTRACT_PUBLIC_KEY = "4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604=";
const CONTRACT_PREVIEW_CSP = "sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'";

describe("free downloads", () => {
  it("serves any approved wallpaper with no account, plus X-Content-SHA256, and counts it", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const res = await call(`/api/wallpapers/${wp.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-SHA256")).toBe(wp.sha);
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(wp.size);
    const row = await env.DB.prepare("SELECT downloads FROM wallpapers WHERE id = ?").bind(wp.id).first<{ downloads: number }>();
    expect(row!.downloads).toBe(1);
  });

  it("never answers 402 and has no checkout endpoint any more", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const dl = await call(`/api/wallpapers/${wp.id}/download`);
    expect(dl.status).not.toBe(402);
    await dl.arrayBuffer();
    const co = await call(`/api/wallpapers/${wp.id}/checkout`, { method: "POST" });
    expect([404, 405]).toContain(co.status);
    expect((await call("/api/stripe/webhook", { method: "POST" })).status).toBe(404);
  });

  it("hides pending wallpapers from the public (detail, download, manifest, preview, page)", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id, status: "pending" });
    for (const p of [`/api/wallpapers/${wp.id}`, `/api/wallpapers/${wp.id}/download`, `/api/wallpapers/${wp.id}/manifest`, `/preview/${wp.id}`, `/community/w/${wp.id}`]) {
      const r = await call(p);
      expect(r.status, p).toBe(404);
      await r.arrayBuffer();
    }
    expect((await call(`/api/wallpapers/${wp.id}`, { cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/community/w/${wp.id}`, { cookie: owner.cookie })).status).toBe(200);
    expect((await call(`/api/wallpapers/${wp.id}/manifest`, { cookie: owner.cookie })).status).toBe(404);
  });
});

describe("signed manifest", () => {
  // Only meaningful with the maintainer's real key; CI signs with an ephemeral key instead.
  it.runIf(env.TEST_SIGNING_KEY_IS_REAL === "1")("the real signing key matches the public key in docs/ARCHITECTURE.md", () => {
    expect(env.TEST_SIGNING_PUBLIC_KEY).toBe(CONTRACT_PUBLIC_KEY);
  });


  it("verifies with the contract public key over the exact message format", async () => {
    const id = "u_" + crypto.randomUUID().slice(0, 12);
    await env.DB.prepare("INSERT INTO users (id, email, display_name) VALUES (?, ?, 'ผู้สร้าง')").bind(id, `${id}@example.com`).run();
    const wp = await insertWallpaper({ ownerId: id });
    const res = await call(`/api/wallpapers/${wp.id}/manifest`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as { id: string; version: number; sha256: string; sizeBytes: number; title: string; author: string; signature: string };
    expect(Object.keys(m).sort()).toEqual(["author", "id", "sha256", "signature", "sizeBytes", "title", "version"]);
    expect(m).toMatchObject({ id: wp.id, version: 1, sha256: wp.sha, sizeBytes: wp.size, author: "ผู้สร้าง" });

    const msg = `macwallpaperpro-manifest-v1\n${wp.id}\n1\n${wp.sha}\n${wp.size}`;
    expect(manifestMessage(m)).toBe(msg);
    const pub = await signingPublicKey();
    const sig = base64ToBytes(m.signature);
    expect(sig.byteLength).toBe(64);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(msg))).toBe(true);
    const tampered = `macwallpaperpro-manifest-v1\n${wp.id}\n1\n${"0".repeat(64)}\n${wp.size}`;
    expect(await crypto.subtle.verify({ name: "Ed25519" }, pub, sig, new TextEncoder().encode(tampered))).toBe(false);
  });
});

describe("preview sandbox", () => {
  it("serves approved HTML with the exact contract CSP (works top-level for the app inspector)", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const res = await call(`/preview/${wp.id}`);
    expect(res.status).toBe(200);
    // The wallpaper policy is unchanged; only frame-ancestors is appended (it never affects the
    // app's top-level WKWebView load, only who may embed the page).
    expect(res.headers.get("Content-Security-Policy")).toBe(`${CONTRACT_PREVIEW_CSP}; frame-ancestors 'self'`);
    expect(PREVIEW_CSP).toBe(CONTRACT_PREVIEW_CSP);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBeNull(); // not iframe-only, not frame-blocked
    expect(await res.text()).toContain("<html");
  });

  it("the local upload-preview shell uses the same locked-down policy and no ad hosts", async () => {
    const res = await call("/preview-sandbox");
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy")!;
    expect(csp).toBe(`${CONTRACT_PREVIEW_CSP}; frame-ancestors 'self'`);
    expect(csp).not.toMatch(/googlesyndication|doubleclick|google/);
    expect(await res.text()).toContain("postMessage");
  });
});

describe("listing, categories and detail", () => {
  it("lists approved items with backward-compatible summaries (priceCents always 0) plus category", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id, category: "cute" });
    const res = await call("/api/wallpapers?sort=new&tag=test");
    const body = (await res.json()) as { items: Record<string, unknown>[]; next: string | null };
    const item = body.items.find((i) => i.id === wp.id)!;
    expect(item).toMatchObject({ priceCents: 0, currency: "thb", tags: ["test"], category: "cute", kind: "html", thumbUrl: `/api/wallpapers/${wp.id}/thumb` });
    expect(Object.keys(item).sort()).toEqual(["author", "category", "createdAt", "currency", "downloads", "id", "kind", "priceCents", "tags", "thumbUrl", "title"]);
    const d = (await (await call(`/api/wallpapers/${wp.id}`)).json()) as Record<string, unknown>;
    expect(d).toMatchObject({ id: wp.id, status: "approved", version: 1, sha256: wp.sha, sizeBytes: wp.size, priceCents: 0, category: "cute" });
  });

  it("filters by ?category= exactly as the app sends it, and rejects unknown categories", async () => {
    const owner = await signedInUser();
    const space = await insertWallpaper({ ownerId: owner.id, category: "space" });
    const nature = await insertWallpaper({ ownerId: owner.id, category: "nature" });
    const res = (await (await call("/api/wallpapers?sort=popular&q=&category=space")).json()) as { items: { id: string; category: string }[] };
    expect(res.items.some((i) => i.id === space.id)).toBe(true);
    expect(res.items.some((i) => i.id === nature.id)).toBe(false);
    expect(res.items.every((i) => i.category === "space")).toBe(true);
    const all = (await (await call("/api/wallpapers")).json()) as { items: { id: string }[] };
    expect(all.items.some((i) => i.id === nature.id)).toBe(true);
    expect((await call("/api/wallpapers?category=bogus")).status).toBe(400);
    const cats = (await (await call("/api/categories")).json()) as { items: { id: string; count: number }[] };
    expect(cats.items.map((c) => c.id)).toEqual(["cute", "nature", "cartoon", "space", "scifi", "abstract"]);
  });

  it("pages with a cursor", async () => {
    const owner = await signedInUser();
    for (let i = 0; i < 26; i++) await insertWallpaper({ ownerId: owner.id, category: "scifi" });
    const p1 = (await (await call("/api/wallpapers?category=scifi")).json()) as { items: { id: string }[]; next: string };
    expect(p1.items).toHaveLength(24);
    expect(p1.next).toBeTruthy();
    const p2 = (await (await call(`/api/wallpapers?category=scifi&cursor=${encodeURIComponent(p1.next)}`)).json()) as { items: { id: string }[] };
    expect(p2.items.length).toBeGreaterThan(0);
    expect(p2.items.some((i) => p1.items.some((j) => j.id === i.id))).toBe(false);
  });
});
