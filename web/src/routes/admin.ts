import { requireAdmin } from "../lib/auth";
import { HttpError, json, readJson } from "../lib/http";
import { parseScan, toDetail, WP_SELECT, type WallpaperRow } from "../lib/wallpapers";

export async function queue(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT w.*, u.display_name AS author_name, u.email AS author_email FROM wallpapers w JOIN users u ON u.id = w.owner_id
     WHERE w.status = 'pending' ORDER BY w.created_at ASC LIMIT 200`,
  ).all<WallpaperRow & { author_email: string }>();
  return json({
    items: results.map((r) => ({
      ...toDetail(r, false),
      authorEmail: r.author_email,
      previewUrl: `/preview/${r.id}`,
      scan: parseScan(r.scan_flags),
    })),
  });
}

export async function review(request: Request, env: Env, id: string, action: "approve" | "reject"): Promise<Response> {
  const { user } = await requireAdmin(request, env);
  let reason: string | null = null;
  if (action === "reject") {
    const body = await readJson(request);
    reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason || reason.length > 500) throw new HttpError(400, "invalid_reason", "ระบุเหตุผลที่ไม่อนุมัติ (ไม่เกิน 500 ตัวอักษร)");
  }
  const row = await env.DB.prepare(`${WP_SELECT} WHERE w.id = ?`).bind(id).first<WallpaperRow>();
  if (!row) throw new HttpError(404, "not_found", "ไม่พบวอลเปเปอร์นี้");
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE wallpapers SET status = ?, reject_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?",
  )
    .bind(action === "approve" ? "approved" : "rejected", reason, now, user.id, now, id)
    .run();
  return json({ id, status: action === "approve" ? "approved" : "rejected" });
}
