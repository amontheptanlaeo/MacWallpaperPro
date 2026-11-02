import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { scanHtml } from "../src/lib/validate";
import { call, HTML, PNG, register } from "./helpers";

function form(over: Partial<Record<"title" | "description" | "tags" | "price_cents", string>> & { file?: Blob | null; thumb?: Blob | null } = {}) {
  const f = new FormData();
  f.set("title", over.title ?? "เนบิวลาทดสอบ");
  f.set("description", over.description ?? "คำอธิบาย");
  f.set("tags", over.tags ?? "Space, Nebula");
  f.set("price_cents", over.price_cents ?? "0");
  if (over.file !== null) f.set("file", over.file ?? new Blob([HTML], { type: "text/html" }), "index.html");
  if (over.thumb !== null) f.set("thumb", over.thumb ?? new Blob([PNG], { type: "image/png" }), "thumb.png");
  return f;
}

async function upload(cookie: string, f: FormData) {
  return call("/api/wallpapers", { method: "POST", cookie, body: f });
}

describe("upload validation", () => {
  it("accepts a valid package as pending, stores it privately with a server-side SHA-256", async () => {
    const { cookie, id: userId } = await register();
    const res = await upload(cookie, form({ price_cents: "2000" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("pending");
    const row = await env.DB.prepare("SELECT * FROM wallpapers WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ owner_id: userId, status: "pending", tags: ",space,nebula,", price_cents: 2000, thumb_type: "image/png" });
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // not public yet
    expect((await call(`/api/wallpapers/${body.id}`)).status).toBe(404);
    const mine = (await (await call("/api/me/wallpapers", { cookie })).json()) as { id: string; status: string }[];
    expect(mine.find((m) => m.id === body.id)?.status).toBe("pending");
  });

  it("requires login", async () => {
    const res = await call("/api/wallpapers", { method: "POST", body: form() });
    expect(res.status).toBe(401);
  });

  it("rejects HTML without <html", async () => {
    const { cookie } = await register();
    const res = await upload(cookie, form({ file: new Blob(["<div>hi</div><script>x()</script>"]) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_file" } });
  });

  it("rejects HTML over 10 MB", async () => {
    const { cookie } = await register();
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x20);
    big.set(new TextEncoder().encode("<html>"), 0);
    const res = await upload(cookie, form({ file: new Blob([big]) }));
    expect(res.status).toBe(413);
  });

  it("rejects a thumbnail whose magic bytes are not PNG/JPEG/WebP, even if labeled image/png", async () => {
    const { cookie } = await register();
    const res = await upload(cookie, form({ thumb: new Blob(["<svg onload=alert(1)>"], { type: "image/png" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_thumb" } });
  });

  it("rejects a thumbnail over 2 MB", async () => {
    const { cookie } = await register();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG, 0);
    const res = await upload(cookie, form({ thumb: new Blob([big]) }));
    expect(res.status).toBe(413);
  });

  it("rejects missing files and invalid prices", async () => {
    const { cookie } = await register();
    expect((await upload(cookie, form({ file: null }))).status).toBe(400);
    expect((await upload(cookie, form({ thumb: null }))).status).toBe(400);
    const cheap = await upload(cookie, form({ price_cents: "1000" }));
    expect(cheap.status).toBe(400);
    expect(await cheap.json()).toMatchObject({ error: { code: "invalid_price" } });
    expect((await upload(cookie, form({ price_cents: "-5" }))).status).toBe(400);
  });

  it("scanner flags network and dynamic-code patterns for the admin queue", async () => {
    const evil = `<html><body><script>fetch("https://tracker.example/x");new WebSocket("wss://a.example");eval("1");importScripts("x");</script>
      <svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>`;
    const ids = scanHtml(evil).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["fetch", "websocket", "eval", "import_scripts", "external_url"]));
    const urls = scanHtml(evil).find((f) => f.id === "external_url")!;
    expect(urls.count).toBe(2); // https://tracker.example + wss://a.example; the w3.org SVG namespace is ignored
    expect(scanHtml("<html><body><canvas></canvas></body></html>")).toEqual([]);

    const { cookie } = await register();
    const up = (await (await upload(cookie, form({ file: new Blob([evil]) }))).json()) as { id: string };
    const admin = await register("admin@example.com").catch(() => null);
    const login = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "admin@example.com", password: "correct horse battery" }) });
    const adminCookie = (login.headers.get("Set-Cookie") || admin?.cookie || "").split(";")[0];
    const q = (await (await call("/api/admin/queue", { cookie: adminCookie })).json()) as { items: { id: string; scan: { id: string }[] }[] };
    const item = q.items.find((i) => i.id === up.id)!;
    expect(item.scan.map((s) => s.id)).toContain("fetch");
    // non-admins cannot see the queue
    expect((await call("/api/admin/queue", { cookie })).status).toBe(403);
    // approve publishes it
    const ap = await call(`/api/admin/wallpapers/${up.id}/approve`, { method: "POST", cookie: adminCookie });
    expect(ap.status).toBe(200);
    expect((await call(`/api/wallpapers/${up.id}`)).status).toBe(200);
  });
});
