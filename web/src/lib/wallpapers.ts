import type { User } from "./auth";
import type { ScanFinding } from "./validate";

export interface WallpaperRow {
  id: string;
  owner_id: string;
  author_name: string;
  title: string;
  description: string;
  tags: string;
  price_cents: number;
  currency: string;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  version: number;
  sha256: string;
  size_bytes: number;
  file_key: string;
  thumb_key: string;
  thumb_type: string;
  downloads: number;
  scan_flags: string;
  created_at: string;
}

export const WP_SELECT = `SELECT w.*, u.display_name AS author_name FROM wallpapers w JOIN users u ON u.id = w.owner_id`;

export interface WallpaperSummary {
  id: string;
  title: string;
  author: { id: string; name: string };
  priceCents: number;
  currency: "thb";
  thumbUrl: string;
  downloads: number;
  tags: string[];
  createdAt: string;
}

export interface WallpaperDetail extends WallpaperSummary {
  description: string;
  version: number;
  sizeBytes: number;
  sha256: string;
  owned: boolean;
  status: "pending" | "approved" | "rejected";
}

export function parseTags(s: string): string[] {
  return s.split(",").filter(Boolean);
}

export function toSummary(r: WallpaperRow): WallpaperSummary {
  return {
    id: r.id,
    title: r.title,
    author: { id: r.owner_id, name: r.author_name },
    priceCents: r.price_cents,
    currency: "thb",
    // Relative to the site base URL (the app resolves it against its configured base).
    thumbUrl: `/api/wallpapers/${r.id}/thumb`,
    downloads: r.downloads,
    tags: parseTags(r.tags),
    createdAt: r.created_at,
  };
}

export function toDetail(r: WallpaperRow, owned: boolean): WallpaperDetail {
  return {
    ...toSummary(r),
    description: r.description,
    version: r.version,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    owned,
    status: r.status,
  };
}

export function parseScan(s: string): ScanFinding[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Who may see a non-approved wallpaper (detail, preview, thumb, download). */
export function canSeeUnpublished(user: User | null, r: WallpaperRow): boolean {
  return !!user && (user.id === r.owner_id || user.role === "admin");
}

export async function hasPurchased(env: Env, userId: string, wallpaperId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM purchases WHERE user_id = ? AND wallpaper_id = ? AND status = 'paid' LIMIT 1")
    .bind(userId, wallpaperId)
    .first();
  return !!row;
}

export async function inLibrary(env: Env, userId: string, wallpaperId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT 1 AS ok FROM library WHERE user_id = ? AND wallpaper_id = ?")
    .bind(userId, wallpaperId)
    .first();
  return !!row;
}
