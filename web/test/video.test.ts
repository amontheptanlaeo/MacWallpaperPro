import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { base64ToBytes, sha256Hex } from "../src/lib/crypto";
import { manifestMessage, manifestMessageV2 } from "../src/lib/manifest";
import { parseRange } from "../src/routes/public";
import { sniffVideo } from "../src/lib/validate";
import { call, fakeMp4, HTML, insertVideo, insertWallpaper, PNG, signedInUser, signingPublicKey } from "./helpers";

const CONTRACT_VIDEO_PREVIEW_CSP = "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; sandbox allow-scripts";
const enc = new TextEncoder();
// Real key locally, ephemeral key in CI (vitest.config.ts); store.test.ts checks the real one
// against the published contract key.
const publicKey = signingPublicKey;

type Manifest = { format?: number; kind?: string; id: string; version: number; sha256: string; sizeBytes: number; title: string; author: string; signature: string };

describe("manifest v2 (video)", () => {
  it("signs the exact v2 message with the contract key; the kind is covered by the signature", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id });
    const res = await call(`/api/wallpapers/${v.id}/manifest`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as Manifest;
    expect(Object.keys(m).sort()).toEqual(["author", "format", "id", "kind", "sha256", "signature", "sizeBytes", "title", "version"]);
    expect(m).toMatchObject({ format: 2, kind: "video", id: v.id, version: 1, sha256: v.sha, sizeBytes: v.size });

    const msg = `macwallpaperpro-manifest-v2\n${v.id}\n1\nvideo\n${v.sha}\n${v.size}`;
    expect(manifestMessageV2({ ...m, kind: m.kind! })).toBe(msg);
    const key = await publicKey();
    const sig = base64ToBytes(m.signature);
    expect(sig.byteLength).toBe(64);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(msg))).toBe(true);
    // Not valid as v1 (an old app can't be tricked into treating it as HTML), nor with another kind or hash.
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(manifestMessage(m)))).toBe(false);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(msg.replace("\nvideo\n", "\nhtml\n")))).toBe(false);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, sig, enc.encode(msg.replace(v.sha, "0".repeat(64))))).toBe(false);
  });

  it("keeps HTML manifests on v1, byte-for-byte the old shape", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const m = (await (await call(`/api/wallpapers/${wp.id}/manifest`)).json()) as Manifest;
    expect(m).not.toHaveProperty("format");
    expect(m).not.toHaveProperty("kind");
    const key = await publicKey();
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(m.signature), enc.encode(`macwallpaperpro-manifest-v1\n${wp.id}\n1\n${wp.sha}\n${wp.size}`))).toBe(true);
  });
});

describe("video download", () => {
  it("streams video/mp4 with the SHA-256 header, and counts only full (non-Range) downloads", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id });
    const res = await call(`/api/wallpapers/${v.id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("X-Content-SHA256")).toBe(v.sha);
    expect(res.headers.get("Content-Length")).toBe(String(v.size));
    // The sandboxed /preview page has an opaque origin; CORP would make browsers drop the video.
    expect(res.headers.get("Cross-Origin-Resource-Policy")).toBeNull();
    const body = new Uint8Array(await res.arrayBuffer());
    expect(await sha256Hex(body)).toBe(v.sha);

    const part = await call(`/api/wallpapers/${v.id}/download`, { headers: { Range: "bytes=0-1" } });
    await part.arrayBuffer();
    const row = await env.DB.prepare("SELECT downloads FROM wallpapers WHERE id = ?").bind(v.id).first<{ downloads: number }>();
    expect(row!.downloads).toBe(1);
  });

  it("answers Range requests with 206 + Content-Range (so <video> can seek), and 416 when unsatisfiable", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id });
    const r1 = await call(`/api/wallpapers/${v.id}/download`, { headers: { Range: "bytes=100-199" } });
    expect(r1.status).toBe(206);
    expect(r1.headers.get("Content-Type")).toBe("video/mp4");
    expect(r1.headers.get("Content-Range")).toBe(`bytes 100-199/${v.size}`);
    expect(r1.headers.get("Content-Length")).toBe("100");
    expect(new Uint8Array(await r1.arrayBuffer())).toEqual(v.bytes.slice(100, 200));

    const open = await call(`/api/wallpapers/${v.id}/download`, { headers: { Range: `bytes=${v.size - 10}-` } });
    expect(open.status).toBe(206);
    expect(open.headers.get("Content-Range")).toBe(`bytes ${v.size - 10}-${v.size - 1}/${v.size}`);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(v.bytes.slice(v.size - 10));

    const suffix = await call(`/api/wallpapers/${v.id}/download`, { headers: { Range: "bytes=-16" } });
    expect(suffix.status).toBe(206);
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(v.bytes.slice(v.size - 16));

    const bad = await call(`/api/wallpapers/${v.id}/download`, { headers: { Range: `bytes=${v.size}-` } });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("Content-Range")).toBe(`bytes */${v.size}`);
    await bad.arrayBuffer();

    expect(parseRange("bytes=0-0,5-6", 10)).toBeNull(); // multi-range: whole file
    expect(parseRange("bytes=5-1000", 10)).toEqual({ offset: 5, length: 5 });
  });

  it("leaves the HTML download exactly as before (octet-stream, no ranges)", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    const res = await call(`/api/wallpapers/${wp.id}/download`, { headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="index.html"');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe(HTML);
  });
});

describe("video preview", () => {
  it("is a tiny full-bleed <video> page under the strict CSP + sandbox, usable top-level", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id });
    const res = await call(`/preview/${v.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(`${CONTRACT_VIDEO_PREVIEW_CSP}; frame-ancestors 'self'`);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(res.headers.get("X-Frame-Options")).toBeNull();
    const html = await res.text();
    expect(html).toMatch(/<video autoplay loop muted playsinline[^>]* src="\/api\/wallpapers\/[a-z0-9]+\/download"/);
    expect(html).not.toContain("<script");
    expect(res.headers.get("Content-Security-Policy")).not.toMatch(/allow-same-origin|script-src/);
  });
});

describe("listing videos", () => {
  it("always includes kind, filters with ?kind=, and gives legacy app builds HTML only", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id, category: "nature" });
    const h = await insertWallpaper({ ownerId: owner.id, category: "nature" });
    type L = { items: { id: string; kind: string }[] };
    const all = (await (await call("/api/wallpapers?category=nature")).json()) as L;
    expect(all.items.find((i) => i.id === v.id)?.kind).toBe("video");
    expect(all.items.find((i) => i.id === h.id)?.kind).toBe("html");
    const vids = (await (await call("/api/wallpapers?kind=video")).json()) as L;
    expect(vids.items.length).toBeGreaterThan(0);
    expect(vids.items.every((i) => i.kind === "video")).toBe(true);
    const html = (await (await call("/api/wallpapers?kind=html&category=nature")).json()) as L;
    expect(html.items.some((i) => i.id === v.id)).toBe(false);
    expect(html.items.some((i) => i.id === h.id)).toBe(true);
    expect((await call("/api/wallpapers?kind=gif")).status).toBe(400);

    const legacyUA = { "User-Agent": "MacWallpaperPro/1 CFNetwork/3860.100.1 Darwin/25.0.0" };
    const legacy = (await (await call("/api/wallpapers?sort=new&category=nature", { headers: legacyUA })).json()) as L;
    expect(legacy.items.some((i) => i.id === v.id)).toBe(false);
    const newer = (await (await call("/api/wallpapers?sort=new&category=nature&kind=all", { headers: legacyUA })).json()) as L;
    expect(newer.items.some((i) => i.id === v.id)).toBe(true);

    const d = (await (await call(`/api/wallpapers/${v.id}`)).json()) as Record<string, unknown>;
    expect(d).toMatchObject({ kind: "video", credit: "NASA Goddard", license: "Public domain (NASA)", sourceUrl: "https://svs.gsfc.nasa.gov/1" });
    const dh = (await (await call(`/api/wallpapers/${h.id}`)).json()) as Record<string, unknown>;
    expect(dh).toMatchObject({ kind: "html", credit: null, license: null, sourceUrl: null });
  });

  it("shows the Video badge, the Videos chip and the credit/license on the website", async () => {
    const owner = await signedInUser();
    const v = await insertVideo({ ownerId: owner.id, category: "scifi" });
    const browse = await (await call("/community?kind=video")).text();
    expect(browse).toContain(`data-id="${v.id}" data-kind="video"`);
    expect(browse).toMatch(/class="card__badge"/);
    expect(browse).toMatch(/class="chip chip--video"[^>]*aria-current="true"/);
    expect(browse).toMatch(/<video class="card__frame card__video" muted loop playsinline preload="none"/);
    const detail = await (await call(`/community/w/${v.id}`)).text();
    expect(detail).toContain("NASA Goddard");
    expect(detail).toContain("Public domain (NASA)");
    expect(detail).toContain(`src="/api/wallpapers/${v.id}/download"`);
  });
});

// ---------------------------------------------------------------------------
// Two-step upload
// ---------------------------------------------------------------------------
function draftForm(over: Record<string, string | null> = {}) {
  const f = new FormData();
  const base: Record<string, string> = {
    kind: "video", title: "Earth at night", description: "City lights", tags: "earth, night", category: "space",
    credit: "NASA Earth Observatory", license: "Public domain (NASA)", sourceUrl: "https://earthobservatory.nasa.gov/x", rights: "on",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) f.set(k, v);
  f.set("thumb", new Blob([PNG], { type: "image/png" }), "thumb.png");
  return f;
}

async function createDraft(cookie: string, over: Record<string, string | null> = {}) {
  const res = await call("/api/wallpapers", { method: "POST", cookie, body: draftForm(over) });
  return { res, body: (await res.json()) as { id: string; status: string; uploadUrl: string; error?: { code: string } } };
}

const putVideo = (cookie: string, url: string, bytes: Uint8Array, sha: string, extra: Record<string, string> = {}) =>
  call(url, { method: "PUT", cookie, body: bytes, headers: { "Content-Length": String(bytes.byteLength), "X-Content-SHA256": sha, "Content-Type": "video/mp4", ...extra } });

describe("video upload (draft + PUT)", () => {
  it("creates a hidden draft, then stores R2-verified bytes and joins the moderation queue", async () => {
    const { cookie } = await signedInUser();
    const { res, body } = await createDraft(cookie);
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ status: "draft", uploadUrl: `/api/uploads/${body.id}/video` });
    const admin = await signedInUser("admin@example.com", "Admin");
    type Q = { items: { id: string; kind: string; credit: string }[] };
    const q0 = (await (await call("/api/admin/queue", { cookie: admin.cookie })).json()) as Q;
    expect(q0.items.some((i) => i.id === body.id)).toBe(false);
    const early = await call(`/api/admin/wallpapers/${body.id}/approve`, { method: "POST", cookie: admin.cookie });
    expect(early.status).toBe(409);
    await early.arrayBuffer();

    const bytes = fakeMp4(64 * 1024);
    const sha = await sha256Hex(bytes);
    const put = await putVideo(cookie, body.uploadUrl, bytes, sha);
    expect(put.status).toBe(201);
    expect(await put.json()).toMatchObject({ id: body.id, status: "pending" });
    const row = await env.DB.prepare("SELECT * FROM wallpapers WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ kind: "video", draft: 0, sha256: sha, size_bytes: bytes.byteLength, status: "pending", credit: "NASA Earth Observatory", license: "Public domain (NASA)" });
    const obj = await env.BUCKET.get(`wallpapers/${body.id}/v1/video.mp4`);
    expect(new Uint8Array(await obj!.arrayBuffer())).toEqual(bytes);

    const again = await putVideo(cookie, body.uploadUrl, bytes, sha);
    expect(again.status).toBe(409);
    await again.arrayBuffer();

    const q1 = (await (await call("/api/admin/queue", { cookie: admin.cookie })).json()) as Q;
    expect(q1.items.find((i) => i.id === body.id)).toMatchObject({ kind: "video", credit: "NASA Earth Observatory" });
    expect((await call(`/api/admin/wallpapers/${body.id}/approve`, { method: "POST", cookie: admin.cookie })).status).toBe(200);
    const m = (await (await call(`/api/wallpapers/${body.id}/manifest`)).json()) as Manifest;
    expect(m).toMatchObject({ format: 2, kind: "video", sha256: sha, sizeBytes: bytes.byteLength });
  });

  it("requires credit, license, a valid source link and the rights confirmation", async () => {
    const { cookie } = await signedInUser();
    const cases: [Record<string, string | null>, string][] = [
      [{ credit: "" }, "invalid_credit"],
      [{ license: null }, "invalid_license"],
      [{ sourceUrl: "javascript:alert(1)" }, "invalid_source_url"],
      [{ rights: null }, "rights_required"],
    ];
    for (const [over, code] of cases) {
      const { res, body } = await createDraft(cookie, over);
      expect(res.status, code).toBe(400);
      expect(body.error?.code).toBe(code);
    }
  });

  it("rejects bytes that are not MP4/MOV by peeking at the first chunk", async () => {
    const { cookie } = await signedInUser();
    const { body } = await createDraft(cookie);
    const html = enc.encode("<html><body>not a video at all</body></html>");
    const res = await putVideo(cookie, body.uploadUrl, html, await sha256Hex(html));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_video" } });
    expect(await env.BUCKET.head(`wallpapers/${body.id}/v1/video.mp4`)).toBeNull();
    expect(sniffVideo(fakeMp4(64))).toBe(true);
    expect(sniffVideo(PNG)).toBe(false);
  });

  it("rejects an oversize Content-Length (> 60 MB) before reading the body, and a missing length", async () => {
    const { cookie } = await signedInUser();
    const { body } = await createDraft(cookie);
    const small = fakeMp4(1024);
    const big = await putVideo(cookie, body.uploadUrl, small, await sha256Hex(small), { "Content-Length": String(60 * 1024 * 1024 + 1) });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: { code: "file_too_large" } });
    const noLen = await call(body.uploadUrl, { method: "PUT", cookie, body: new ReadableStream({ start: (c) => (c.enqueue(small), c.close()) }), headers: { "X-Content-SHA256": "0".repeat(64) }, duplex: "half" } as RequestInit);
    expect(noLen.status).toBe(411);
    await noLen.arrayBuffer();
  });

  it("lets R2 reject a SHA-256 mismatch: nothing is stored and the draft stays a draft", async () => {
    const { cookie } = await signedInUser();
    const { body } = await createDraft(cookie);
    const bytes = fakeMp4(32 * 1024);
    const res = await putVideo(cookie, body.uploadUrl, bytes, "a".repeat(64));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "hash_mismatch" } });
    expect(await env.BUCKET.head(`wallpapers/${body.id}/v1/video.mp4`)).toBeNull();
    const row = await env.DB.prepare("SELECT draft, sha256 FROM wallpapers WHERE id = ?").bind(body.id).first<{ draft: number; sha256: string }>();
    expect(row).toEqual({ draft: 1, sha256: "" });
    expect((await call(`/api/wallpapers/${body.id}/manifest`)).status).toBe(404);
    // A retry with the right hash still works.
    const ok = await putVideo(cookie, body.uploadUrl, bytes, await sha256Hex(bytes));
    expect(ok.status).toBe(201);
    await ok.arrayBuffer();
  });

  it("only the draft's owner can upload its video", async () => {
    const a = await signedInUser();
    const b = await signedInUser();
    const { body } = await createDraft(a.cookie);
    const bytes = fakeMp4(1024);
    const res = await putVideo(b.cookie, body.uploadUrl, bytes, await sha256Hex(bytes));
    expect(res.status).toBe(404);
    await res.arrayBuffer();
    const anon = await call(body.uploadUrl, { method: "PUT", body: bytes, headers: { "Content-Length": "1024", "X-Content-SHA256": await sha256Hex(bytes) } });
    expect(anon.status).toBe(401);
    await anon.arrayBuffer();
  });
});
