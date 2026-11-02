import { createApiToken, getAuth, requireAuth } from "../lib/auth";
import { clientIp, escapeHtml, HttpError, html, SECURITY_HEADERS } from "../lib/http";
import { LIMITS, rateLimit } from "../lib/ratelimit";

export const RELEASE_KEY = "releases/MacWallpaperPro.zip";
/** ไฟล์แจกหลักอยู่ใน GitHub Releases (ฟรี bandwidth ไม่จำกัด) — ลิงก์ latest ชี้เวอร์ชันล่าสุดเสมอ */
export const GITHUB_RELEASE_URL =
  "https://github.com/amontheptanlaeo/MacWallpaperPro/releases/latest/download/MacWallpaperPro.zip";

function layout(title: string, body: string, scripts: string[] = []): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | MacWallpaperPro</title>
<meta name="color-scheme" content="dark">
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@400;500;600;700&family=IBM+Plex+Sans+Thai+Looped:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/site.css">
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
</head>
<body class="page">
<a class="skip" href="#main">ข้ามไปเนื้อหา</a>
<header class="menubar" data-menubar></header>
<main id="main" class="shell narrow">
${body}
</main>
<script type="module" src="/assets/js/chrome.js"></script>
</body>
</html>`;
}

export async function downloadApp(env: Env): Promise<Response> {
  // 1) GitHub Releases: มีไฟล์เมื่อ GitHub ตอบ redirect ไปยังไฟล์จริง
  try {
    const head = await fetch(GITHUB_RELEASE_URL, { method: "HEAD", redirect: "manual" });
    if (head.status >= 300 && head.status < 400) {
      return new Response(null, { status: 302, headers: { Location: GITHUB_RELEASE_URL, "Cache-Control": "public, max-age=300" } });
    }
  } catch {
    // GitHub ล่ม → ลอง R2 ต่อ
  }
  // 2) สำรอง: R2
  const obj = await env.BUCKET.get(RELEASE_KEY);
  if (obj) {
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(obj.size),
        "Content-Disposition": 'attachment; filename="MacWallpaperPro.zip"',
        "Cache-Control": "public, max-age=300",
        ...(obj.httpEtag ? { ETag: obj.httpEtag } : {}),
        ...SECURITY_HEADERS,
      },
    });
  }
  return html(
    layout(
      "เร็วๆ นี้",
      `<section class="panel center-panel">
  <svg class="panel-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <h1>ตัวติดตั้งกำลังจะมา</h1>
  <p class="lede">เรากำลังเตรียม MacWallpaperPro เวอร์ชันแรกให้ดาวน์โหลด ระหว่างนี้ลองเลือกวอลเปเปอร์ในร้านชุมชนเก็บไว้ก่อนได้</p>
  <p class="muted">ต้องใช้ macOS 15 ขึ้นไป</p>
  <div class="actions"><a class="btn primary" href="/community">ไปที่ร้านชุมชน</a><a class="btn ghost" href="/">กลับหน้าแรก</a></div>
</section>`,
    ),
    404,
  );
}

/** Serve the static detail page for the app's "buy on web" deep path: /community/w/<id>. */
export async function wallpaperPage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new Request(new URL("/community/w", url), { headers: request.headers }));
  return new Response(res.body, res);
}

export async function connectPage(request: Request, env: Env): Promise<Response> {
  const auth = await getAuth(request, env).catch(() => null);
  if (!auth || auth.via !== "session") {
    return new Response(null, { status: 302, headers: { Location: "/community/login?next=%2Fapp%2Fconnect" } });
  }
  const u = auth.user;
  return html(
    layout(
      "เชื่อมแอป",
      `<section class="panel connect">
  <div class="connect-art" aria-hidden="true">
    <svg viewBox="0 0 120 48"><rect x="2" y="6" width="46" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 44h22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="60" cy="23" r="3" fill="currentColor"/><circle cx="70" cy="23" r="2" fill="currentColor" opacity=".6"/><circle cx="50" cy="23" r="2" fill="currentColor" opacity=".6"/><rect x="78" y="4" width="40" height="38" rx="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M90 30l8-14 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
  </div>
  <h1>เชื่อม MacWallpaperPro กับบัญชีนี้</h1>
  <p class="lede">แอปบน Mac จะใช้บัญชี <strong>${escapeHtml(u.displayName)}</strong> (${escapeHtml(u.email)}) เพื่อติดตั้งวอลเปเปอร์ที่คุณซื้อไว้</p>
  <ul class="ticks">
    <li>แอปได้สิทธิ์ดูคลังและดาวน์โหลดวอลเปเปอร์ของคุณ</li>
    <li>แอปไม่เห็นรหัสผ่าน และจ่ายเงินแทนคุณไม่ได้</li>
    <li>สิทธิ์มีอายุ 90 วัน ยกเลิกได้ทุกเมื่อจากหน้านี้</li>
  </ul>
  <form method="post" action="/app/connect" class="actions">
    <button class="btn primary" type="submit">อนุญาตและเปิดแอป</button>
    <a class="btn ghost" href="/community">ยกเลิก</a>
  </form>
</section>
<section class="panel" aria-labelledby="devices-h">
  <h2 id="devices-h">อุปกรณ์ที่เชื่อมอยู่</h2>
  <div data-devices><p class="muted">กำลังโหลด…</p></div>
</section>`,
      ["/assets/js/connect.js"],
    ),
  );
}

export async function connectSubmit(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  if (auth.via !== "session") throw new HttpError(403, "forbidden", "ต้องยืนยันผ่านหน้าเว็บ");
  await rateLimit(env, `connect:${auth.user.id}:${clientIp(request)}`, LIMITS.connect);
  const { token } = await createApiToken(env, auth.user.id, "MacWallpaperPro บน Mac");
  return new Response(null, {
    status: 303,
    headers: { Location: `macwallpaperpro://auth?token=${encodeURIComponent(token)}`, "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}
