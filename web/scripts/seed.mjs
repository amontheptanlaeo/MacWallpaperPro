#!/usr/bin/env node
// Seed the LOCAL D1 + R2 (wrangler dev state) with the bundled "Nebula Flow" wallpaper.
// Idempotent: safe to run repeatedly. Never touches remote resources (--local only).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, "..");
const htmlPath = resolve(webDir, "../Wallpapers/nebula/index.html");
const thumbPath = resolve(here, "seed-assets/nebula-thumb.jpg");
const BUCKET = "macwallpaperpro-files";
const DB = "DB";

const ID = "nebula-flow";
const VERSION = 1;
const OWNER = { id: "u_macwallpaperpro", email: "team@macwallpaperpro.local", name: "MacWallpaperPro" };

const html = readFileSync(htmlPath);
if (!/<html[\s>]/i.test(html.toString("utf8"))) throw new Error("nebula index.html has no <html tag");
const sha256 = createHash("sha256").update(html).digest("hex");
const fileKey = `wallpapers/${ID}/v${VERSION}/index.html`;
const thumbKey = `wallpapers/${ID}/thumb`;

const wrangler = join(webDir, "node_modules/.bin/wrangler");
const run = (args) => execFileSync(wrangler, args, { cwd: webDir, stdio: ["ignore", "inherit", "inherit"] });

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const description =
  "เนบิวลาที่ไหลเหมือนควันสีในอวกาศ เคอร์เซอร์ของคุณดึงแสงให้โค้งตามแรงโน้มถ่วง คลิกเพื่อปล่อยคลื่น " +
  "และอนุภาคจะวนรอบเมาส์พร้อมเส้นเชื่อมดาว ถ้าไม่ขยับเมาส์สักพัก ภาพจะลอยไปเองอย่างช้าๆ";

const sql = `
INSERT INTO users (id, email, password_hash, display_name, role)
VALUES (${q(OWNER.id)}, ${q(OWNER.email)}, '!login-disabled', ${q(OWNER.name)}, 'user')
ON CONFLICT(id) DO NOTHING;

INSERT INTO wallpapers (id, owner_id, title, description, tags, price_cents, status, version, sha256, size_bytes,
  file_key, thumb_key, thumb_type, scan_flags, reviewed_at)
VALUES (${q(ID)}, ${q(OWNER.id)}, 'Nebula Flow', ${q(description)}, ',nebula,space,interactive,', 0, 'approved', ${VERSION},
  ${q(sha256)}, ${html.byteLength}, ${q(fileKey)}, ${q(thumbKey)}, 'image/jpeg', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256, size_bytes = excluded.size_bytes, file_key = excluded.file_key,
  thumb_key = excluded.thumb_key, thumb_type = excluded.thumb_type, status = 'approved', description = excluded.description;
`;

const tmp = mkdtempSync(join(tmpdir(), "mwp-seed-"));
try {
  const sqlFile = join(tmp, "seed.sql");
  writeFileSync(sqlFile, sql);
  console.log("→ D1 (local): seeding Nebula Flow");
  run(["d1", "execute", DB, "--local", "--file", sqlFile]);
  console.log("→ R2 (local): uploading index.html + thumbnail");
  run(["r2", "object", "put", `${BUCKET}/${fileKey}`, "--local", "--file", htmlPath, "--content-type", "text/html; charset=utf-8"]);
  run(["r2", "object", "put", `${BUCKET}/${thumbKey}`, "--local", "--file", thumbPath, "--content-type", "image/jpeg"]);
  console.log(`✓ Seeded ${ID} (sha256 ${sha256}, ${html.byteLength} bytes)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
