import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { scanHtml } from "../src/lib/validate";
import { call, HTML, PNG, signedInUser } from "./helpers";

function form(over: Partial<Record<"title" | "description" | "tags" | "category", string>> & { file?: Blob | null; thumb?: Blob | null } = {}) {
  const f = new FormData();
  f.set("title", over.title ?? "Test nebula");
  f.set("description", over.description ?? "A description");
  f.set("tags", over.tags ?? "Space, Nebula");
  f.set("category", over.category ?? "space");
  if (over.file !== null) f.set("file", over.file ?? new Blob([HTML], { type: "text/html" }), "index.html");
  if (over.thumb !== null) f.set("thumb", over.thumb ?? new Blob([PNG], { type: "image/png" }), "thumb.png");
  return f;
}

const upload = (cookie: string, f: FormData) => call("/api/wallpapers", { method: "POST", cookie, body: f });

describe("upload validation", () => {
  it("accepts a valid package as pending, stores it privately with a server-side SHA-256 and category", async () => {
    const { cookie, id: userId } = await signedInUser();
    const res = await upload(cookie, form());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("pending");
    const row = await env.DB.prepare("SELECT * FROM wallpapers WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ owner_id: userId, status: "pending", title: "Test nebula", description: "A description", tags: ",space,nebula,", category: "space", thumb_type: "image/png" });
    expect(row).not.toHaveProperty("price_cents");
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await call(`/api/wallpapers/${body.id}`)).status).toBe(404);
    const mine = (await (await call("/api/me/wallpapers", { cookie })).json()) as { id: string; status: string }[];
    expect(mine.find((m) => m.id === body.id)?.status).toBe("pending");
  });

  it("requires a signed-in creator and a same-site Origin", async () => {
    expect((await call("/api/wallpapers", { method: "POST", body: form() })).status).toBe(401);
    const { cookie } = await signedInUser();
    const foreign = await call("/api/wallpapers", { method: "POST", cookie, body: form(), headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: { code: "bad_origin" } });
    expect((await call("/api/wallpapers", { method: "POST", cookie, body: form(), noOrigin: true })).status).toBe(403);
  });

  it("rejects HTML without <html", async () => {
    const { cookie } = await signedInUser();
    const res = await upload(cookie, form({ file: new Blob(["<div>hi</div><script>x()</script>"]) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_file" } });
  });

  it("rejects HTML over 10 MB", async () => {
    const { cookie } = await signedInUser();
    const big = new Uint8Array(10 * 1024 * 1024 + 1).fill(0x20);
    big.set(new TextEncoder().encode("<html>"), 0);
    expect((await upload(cookie, form({ file: new Blob([big]) }))).status).toBe(413);
  });

  it("rejects a thumbnail whose magic bytes are not PNG/JPEG/WebP, even if labeled image/png", async () => {
    const { cookie } = await signedInUser();
    const res = await upload(cookie, form({ thumb: new Blob(["<svg onload=alert(1)>"], { type: "image/png" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_thumb" } });
  });

  it("rejects a thumbnail over 2 MB", async () => {
    const { cookie } = await signedInUser();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG, 0);
    expect((await upload(cookie, form({ thumb: new Blob([big]) }))).status).toBe(413);
  });

  it("rejects missing files, a missing/unknown category and bad titles", async () => {
    const { cookie } = await signedInUser();
    expect((await upload(cookie, form({ file: null }))).status).toBe(400);
    expect((await upload(cookie, form({ thumb: null }))).status).toBe(400);
    for (const category of ["", "paid", "SPACE OR 1=1"]) {
      const r = await upload(cookie, form({ category }));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: { code: "invalid_category" } });
    }
    expect((await upload(cookie, form({ title: "" }))).status).toBe(400);
    expect((await upload(cookie, form({ title: "x".repeat(81) }))).status).toBe(400);
    expect((await upload(cookie, form({ tags: "a,b,c,d,e,f,g,h,i" }))).status).toBe(400);
  });

  it("scanner flags network and dynamic-code patterns, and the admin queue moderates", async () => {
    const evil = `<html><body><script>fetch("https://tracker.example/x");new WebSocket("wss://a.example");eval("1");importScripts("x");</script>
      <svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>`;
    const ids = scanHtml(evil).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["fetch", "websocket", "eval", "import_scripts", "external_url"]));
    expect(scanHtml(evil).find((f) => f.id === "external_url")!.count).toBe(2); // the w3.org namespace is ignored
    expect(scanHtml("<html><body><canvas></canvas><p>Fetch the WEBSOCKET docs</p></body></html>")).toEqual([]);

    const { cookie } = await signedInUser();
    const up = (await (await upload(cookie, form({ file: new Blob([evil]) }))).json()) as { id: string };
    const admin = await signedInUser("admin@example.com", "Admin");
    const q = (await (await call("/api/admin/queue", { cookie: admin.cookie })).json()) as { items: { id: string; scan: { id: string }[] }[] };
    expect(q.items.find((i) => i.id === up.id)!.scan.map((s) => s.id)).toContain("fetch");
    expect((await call("/api/admin/queue", { cookie })).status).toBe(403);
    expect((await call(`/api/admin/wallpapers/${up.id}/reject`, { method: "POST", cookie: admin.cookie, body: "{}" })).status).toBe(400);
    expect((await call(`/api/admin/wallpapers/${up.id}/approve`, { method: "POST", cookie: admin.cookie })).status).toBe(200);
    expect((await call(`/api/wallpapers/${up.id}`)).status).toBe(200);
  });
});
