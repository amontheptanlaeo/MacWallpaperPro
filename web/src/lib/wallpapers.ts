import type { User } from "./auth";
import type { ScanFinding, WallpaperKind } from "./validate";

export interface WallpaperRow {
  id: string;
  owner_id: string;
  author_name: string;
  title: string;
  description: string;
  tags: string;
  category: string;
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
  // migrations/0002_video.sql
  kind: WallpaperKind;
  credit: string | null;
  license: string | null;
  source_url: string | null;
  draft: number;
}

export const WP_SELECT = `SELECT w.*, u.display_name AS author_name FROM wallpapers w JOIN users u ON u.id = w.owner_id`;

/**
 * Contract with the macOS app (docs/ARCHITECTURE.md). Everything is free: `priceCents` is always 0
 * and `currency` stays "thb" only so older app builds keep decoding the response.
 */
export interface WallpaperSummary {
  id: string;
  title: string;
  author: { id: string; name: string };
  priceCents: 0;
  currency: "thb";
  thumbUrl: string;
  downloads: number;
  tags: string[];
  category: string;
  /** "html" (index.html, manifest v1) or "video" (video.mp4, manifest v2). Always present. */
  kind: WallpaperKind;
  createdAt: string;
}

export interface WallpaperDetail extends WallpaperSummary {
  description: string;
  version: number;
  sizeBytes: number;
  sha256: string;
  owned: boolean;
  status: "pending" | "approved" | "rejected";
  /** Attribution (videos). null for HTML wallpapers. */
  credit: string | null;
  license: string | null;
  sourceUrl: string | null;
}

export function parseTags(s: string): string[] {
  return s.split(",").filter(Boolean);
}

export function toSummary(r: WallpaperRow): WallpaperSummary {
  return {
    id: r.id,
    title: r.title,
    author: { id: r.owner_id, name: r.author_name },
    priceCents: 0,
    currency: "thb",
    // Relative to the site base URL (the app resolves it against its configured base).
    thumbUrl: `/api/wallpapers/${r.id}/thumb`,
    downloads: r.downloads,
    tags: parseTags(r.tags),
    category: r.category,
    kind: r.kind === "video" ? "video" : "html",
    createdAt: r.created_at,
  };
}

export function toDetail(r: WallpaperRow): WallpaperDetail {
  return {
    ...toSummary(r),
    description: r.description,
    version: r.version,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    // Kept for old app builds: every approved wallpaper is free, so it is always installable.
    owned: true,
    status: r.status,
    credit: r.credit ?? null,
    license: r.license ?? null,
    sourceUrl: r.source_url ?? null,
  };
}

/** File name inside the package, and the MIME type served by /download. */
export function packageFile(kind: WallpaperKind): { name: string; type: string } {
  return kind === "video" ? { name: "video.mp4", type: "video/mp4" } : { name: "index.html", type: "application/octet-stream" };
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
