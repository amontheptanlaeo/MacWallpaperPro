#!/usr/bin/env node
// Seed D1 + R2 with every bundled wallpaper in ../Wallpapers/<slug>/ (HTML) and
// ../Wallpapers-video/<slug>/ (video) as approved, free wallpapers by "MacWallpaperPro".
//
//   node scripts/seed.mjs            # local wrangler dev state (default)
//   node scripts/seed.mjs --remote   # PRODUCTION D1/R2. Asks for confirmation unless --yes.
//   node scripts/seed.mjs --rerender # re-render cached thumbnails for folders without thumb.jpg
//   node scripts/seed.mjs --video-dir=/path/to/videos   # import videos from another folder (local tests)
//
// A folder is imported when it has index.html plus wallpaper.json
// ({ id, title, description, tags[], category }) — Nebula has built-in metadata below. A missing
// thumb.jpg is rendered with headless Chrome into scripts/seed-assets/thumbs/ (never into Wallpapers/).
// A video folder needs video.mp4 (H.264/HEVC in MP4/MOV, ≤ 60 MB), thumb.jpg (≤ 2 MB) and
// wallpaper.json ({ id, title, description, tags[], category, kind: "video", credit, license, sourceUrl }).
// The SHA-256 is computed here in Node (the Worker never hashes uploads); manifests are signed v2.
// Requires migrations/0002_video.sql. Re-runnable: rows are upserted by id (downloads and
// created_at are kept), files are overwritten.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const wallpapersDir = resolve(webDir, "../Wallpapers");
const thumbCache = resolve(here, "seed-assets/thumbs");
const BUCKET = "macwallpaperpro-files";
const DB = "DB";
const OWNER = { id: "u_macwallpaperpro", email: "team@macwallpaperpro.invalid", name: "MacWallpaperPro" };
const CATEGORIES = new Set(["cute", "nature", "cartoon", "space", "scifi", "abstract"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const args = new Set(process.argv.slice(2));
const videoDirArg = process.argv.slice(2).find((a) => a.startsWith("--video-dir="));
const videosDir = videoDirArg ? resolve(videoDirArg.slice("--video-dir=".length)) : resolve(webDir, "../Wallpapers-video");
const MAX_VIDEO = 60 * 1024 * 1024;
const remote = args.has("--remote");
const target = remote ? "--remote" : "--local";

// Folders that predate wallpaper.json.
const BUILTIN_META = {
  nebula: {
    id: "nebula-flow",
    title: "Nebula Flow",
    description:
      "A nebula that drifts like coloured smoke. Your cursor bends the light like gravity, a click sends out a ripple, and particles orbit the pointer with faint star trails. Leave the mouse alone and it slowly floats on its own.",
    tags: ["nebula", "space", "interactive", "particles"],
    category: "space",
  },
};

function loadMeta(slug, dir) {
  const file = join(dir, "wallpaper.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  return BUILTIN_META[slug] ?? null;
}

function normalizeTags(tags) {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    const v = String(t).trim().toLowerCase().replace(/\s+/g, "-");
    if (v && v.length <= 24 && !/[,<>"'`]/.test(v) && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 8);
}

function renderThumb(slug, htmlPath) {
  mkdirSync(thumbCache, { recursive: true });
  const out = join(thumbCache, `${slug}.jpg`);
  if (existsSync(out) && !args.has("--rerender")) return out;
  if (!existsSync(CHROME)) throw new Error(`No thumb.jpg for ${slug} and Chrome not found at ${CHROME} (set CHROME_PATH)`);
  const tmp = mkdtempSync(join(tmpdir(), "mwp-thumb-"));
  try {
    const png = join(tmp, "shot.png");
    execFileSync(CHROME, [
      "--headless=new", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--force-device-scale-factor=1",
      `--user-data-dir=${join(tmp, "profile")}`, "--window-size=1600,1000", "--virtual-time-budget=5000",
      `--screenshot=${png}`, pathToFileURL(htmlPath).href,
    ], { stdio: "ignore", timeout: 60_000 });
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", png, "--out", out], { stdio: "ignore" });
    console.log(`  rendered thumbnail for ${slug}`);
    return out;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function isMp4(path) {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(12);
    if (readSync(fd, b, 0, 12, 0) < 12) return false;
    return b.toString("latin1", 4, 8) === "ftyp" && /^[\x20-\x7e]{4}$/.test(b.toString("latin1", 8, 12));
  } finally {
    closeSync(fd);
  }
}

function sha256File(path) {
  const h = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}

function collectVideos(seen) {
  const items = [];
  if (!existsSync(videosDir)) return items;
  for (const slug of readdirSync(videosDir).sort()) {
    const dir = join(videosDir, slug);
    if (!statSync(dir).isDirectory()) continue;
    const videoPath = join(dir, "video.mp4");
    const thumbPath = join(dir, "thumb.jpg");
    const metaPath = join(dir, "wallpaper.json");
    if (!existsSync(videoPath) || !existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      console.warn(`- skip video ${slug}: wallpaper.json is not valid JSON`);
      continue;
    }
    const id = String(meta.id || slug).trim();
    const title = String(meta.title || "").trim();
    const category = String(meta.category || "").trim().toLowerCase();
    const credit = String(meta.credit || "").trim();
    const license = String(meta.license || "").trim();
    const sourceUrl = String(meta.sourceUrl || "").trim();
    const problems = [];
    if ((meta.kind ?? "video") !== "video") problems.push(`kind is "${meta.kind}", expected "video"`);
    if (!ID_RE.test(id)) problems.push(`bad id "${id}"`);
    if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    if (!title || [...title].length > 80) problems.push("title missing or over 80 chars");
    if (!CATEGORIES.has(category)) problems.push(`unknown category "${category}"`);
    if (!credit || [...credit].length > 120) problems.push("credit missing or over 120 chars");
    if (!license || [...license].length > 80) problems.push("license missing or over 80 chars");
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) problems.push("sourceUrl must be http(s)");
    const size = statSync(videoPath).size;
    if (size > MAX_VIDEO) problems.push("video.mp4 over 60 MB");
    if (!isMp4(videoPath)) problems.push("video.mp4 has no ftyp box (not MP4/MOV)");
    if (!existsSync(thumbPath)) problems.push("no thumb.jpg");
    else if (statSync(thumbPath).size > 2 * 1024 * 1024) problems.push("thumbnail over 2 MB");
    if (problems.length) {
      console.warn(`- skip video ${slug}: ${problems.join(", ")}`);
      continue;
    }
    seen.add(id);
    items.push({
      kind: "video", slug, id, title, category, filePath: videoPath, thumbPath, credit, license, sourceUrl: sourceUrl || null,
      description: String(meta.description || "").trim().slice(0, 2000),
      tags: normalizeTags(meta.tags),
      sha256: sha256File(videoPath),
      size,
    });
  }
  return items;
}

function collect() {
  const items = [];
  const seen = new Set();
  for (const slug of readdirSync(wallpapersDir).sort()) {
    const dir = join(wallpapersDir, slug);
    if (!statSync(dir).isDirectory()) continue;
    const htmlPath = join(dir, "index.html");
    if (!existsSync(htmlPath)) continue;
    const meta = loadMeta(slug, dir);
    if (!meta) {
      console.warn(`- skip ${slug}: no wallpaper.json`);
      continue;
    }
    const id = String(meta.id || slug).trim();
    const title = String(meta.title || "").trim();
    const category = String(meta.category || "").trim().toLowerCase();
    const problems = [];
    if (!ID_RE.test(id)) problems.push(`bad id "${id}"`);
    if (seen.has(id)) problems.push(`duplicate id "${id}"`);
    if (!title || [...title].length > 80) problems.push("title missing or over 80 chars");
    if (!CATEGORIES.has(category)) problems.push(`unknown category "${category}"`);
    const html = readFileSync(htmlPath);
    if (html.byteLength > 10 * 1024 * 1024) problems.push("index.html over 10 MB");
    if (!/<html[\s>]/i.test(html.toString("utf8"))) problems.push("index.html has no <html> tag");
    if (problems.length) {
      console.warn(`- skip ${slug}: ${problems.join(", ")}`);
      continue;
    }
    let thumbPath = join(dir, "thumb.jpg");
    if (!existsSync(thumbPath)) thumbPath = renderThumb(slug, htmlPath);
    if (statSync(thumbPath).size > 2 * 1024 * 1024) {
      console.warn(`- skip ${slug}: thumbnail over 2 MB`);
      continue;
    }
    seen.add(id);
    items.push({
      kind: "html", slug, id, title, category, filePath: htmlPath, thumbPath, credit: null, license: null, sourceUrl: null,
      description: String(meta.description || "").trim().slice(0, 2000),
      tags: normalizeTags(meta.tags),
      sha256: createHash("sha256").update(html).digest("hex"),
      size: html.byteLength,
    });
  }
  return items;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const n = (s) => (s == null ? "NULL" : q(s));
const fileKeyOf = (w) => `wallpapers/${w.id}/v1/${w.kind === "video" ? "video.mp4" : "index.html"}`;

function buildSql(items) {
  const base = Date.parse("2026-10-01T00:00:00Z");
  const rows = items.map((w, i) => {
    const created = new Date(base + i * 3_600_000).toISOString();
    const fileKey = fileKeyOf(w);
    const thumbKey = `wallpapers/${w.id}/thumb`;
    const tags = w.tags.length ? `,${w.tags.join(",")},` : "";
    return `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes,
  file_key, thumb_key, thumb_type, scan_flags, created_at, reviewed_at, reviewed_by, kind, credit, license, source_url, draft)
VALUES (${q(w.id)}, ${q(OWNER.id)}, ${q(w.title)}, ${q(w.description)}, ${q(tags)}, ${q(w.category)}, 'approved', 1, ${q(w.sha256)}, ${w.size},
  ${q(fileKey)}, ${q(thumbKey)}, 'image/jpeg', '[]', ${q(created)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'seed',
  ${q(w.kind)}, ${n(w.credit)}, ${n(w.license)}, ${n(w.sourceUrl)}, 0)
ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, tags = excluded.tags,
  category = excluded.category, status = 'approved', sha256 = excluded.sha256, size_bytes = excluded.size_bytes,
  file_key = excluded.file_key, thumb_key = excluded.thumb_key, thumb_type = excluded.thumb_type,
  kind = excluded.kind, credit = excluded.credit, license = excluded.license, source_url = excluded.source_url, draft = 0,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`;
  });
  return `INSERT INTO users (id, email, display_name, role) VALUES (${q(OWNER.id)}, ${q(OWNER.email)}, ${q(OWNER.name)}, 'user')
ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name;
${rows.join("\n")}
`;
}

const wrangler = join(webDir, "node_modules/.bin/wrangler");
const run = (a) => execFileSync(wrangler, a, { cwd: webDir, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, CI: "1" } });

async function main() {
  const html = collect();
  const videos = collectVideos(new Set(html.map((w) => w.id)));
  const items = [...html, ...videos];
  if (!items.length) throw new Error("No importable wallpapers found in " + wallpapersDir + " or " + videosDir);
  console.log(`Found ${html.length} HTML wallpapers: ${html.map((w) => w.id).join(", ")}`);
  console.log(`Found ${videos.length} videos in ${videosDir}${videos.length ? ": " + videos.map((w) => w.id).join(", ") : ""}`);
  if (remote && !args.has("--yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question("This writes to the PRODUCTION D1 database and R2 bucket. Type 'seed production' to continue: ");
    rl.close();
    if (ans.trim() !== "seed production") return console.log("Cancelled.");
  }
  const tmp = mkdtempSync(join(tmpdir(), "mwp-seed-"));
  try {
    const sqlFile = join(tmp, "seed.sql");
    writeFileSync(sqlFile, buildSql(items));
    console.log(`→ D1 (${remote ? "remote" : "local"}): upserting ${items.length} rows`);
    run(["d1", "execute", DB, target, "--file", sqlFile, ...(remote ? ["--yes"] : [])]);
    for (const w of items) {
      console.log(`→ R2 (${remote ? "remote" : "local"}): ${w.id}`);
      const type = w.kind === "video" ? "video/mp4" : "text/html; charset=utf-8";
      run(["r2", "object", "put", `${BUCKET}/${fileKeyOf(w)}`, target, "--file", w.filePath, "--content-type", type]);
      run(["r2", "object", "put", `${BUCKET}/wallpapers/${w.id}/thumb`, target, "--file", w.thumbPath, "--content-type", "image/jpeg"]);
    }
    console.log(`✓ Seeded ${items.length} wallpapers`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
