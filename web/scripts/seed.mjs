#!/usr/bin/env node
// Seed D1 + R2 with every bundled wallpaper in ../Wallpapers/<slug>/ as an approved, free wallpaper
// by "MacWallpaperPro".
//
//   node scripts/seed.mjs            # local wrangler dev state (default)
//   node scripts/seed.mjs --remote   # PRODUCTION D1/R2. Asks for confirmation unless --yes.
//   node scripts/seed.mjs --rerender # re-render cached thumbnails for folders without thumb.jpg
//
// A folder is imported when it has index.html plus wallpaper.json
// ({ id, title, description, tags[], category }) — Nebula has built-in metadata below. A missing
// thumb.jpg is rendered with headless Chrome into scripts/seed-assets/thumbs/ (never into Wallpapers/).
// Re-runnable: rows are upserted by id (downloads and created_at are kept), files are overwritten.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
      slug, id, title, category, htmlPath, thumbPath,
      description: String(meta.description || "").trim().slice(0, 2000),
      tags: normalizeTags(meta.tags),
      sha256: createHash("sha256").update(html).digest("hex"),
      size: html.byteLength,
    });
  }
  return items;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function buildSql(items) {
  const base = Date.parse("2026-10-01T00:00:00Z");
  const rows = items.map((w, i) => {
    const created = new Date(base + i * 3_600_000).toISOString();
    const fileKey = `wallpapers/${w.id}/v1/index.html`;
    const thumbKey = `wallpapers/${w.id}/thumb`;
    const tags = w.tags.length ? `,${w.tags.join(",")},` : "";
    return `INSERT INTO wallpapers (id, owner_id, title, description, tags, category, status, version, sha256, size_bytes,
  file_key, thumb_key, thumb_type, scan_flags, created_at, reviewed_at, reviewed_by)
VALUES (${q(w.id)}, ${q(OWNER.id)}, ${q(w.title)}, ${q(w.description)}, ${q(tags)}, ${q(w.category)}, 'approved', 1, ${q(w.sha256)}, ${w.size},
  ${q(fileKey)}, ${q(thumbKey)}, 'image/jpeg', '[]', ${q(created)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'seed')
ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, tags = excluded.tags,
  category = excluded.category, status = 'approved', sha256 = excluded.sha256, size_bytes = excluded.size_bytes,
  file_key = excluded.file_key, thumb_key = excluded.thumb_key, thumb_type = excluded.thumb_type,
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
  const items = collect();
  if (!items.length) throw new Error("No importable wallpapers found in " + wallpapersDir);
  console.log(`Found ${items.length} wallpapers: ${items.map((w) => w.id).join(", ")}`);
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
      run(["r2", "object", "put", `${BUCKET}/wallpapers/${w.id}/v1/index.html`, target, "--file", w.htmlPath, "--content-type", "text/html; charset=utf-8"]);
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
