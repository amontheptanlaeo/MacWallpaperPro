# MacWallpaperPro — Architecture & Contracts

ส่วนประกอบ 3 ส่วน:

1. **แอป macOS** (`Sources/MacWallpaperPro`, Swift/SwiftUI, macOS 15+)
2. **เว็บ** (`web/`, Cloudflare Worker + static assets, D1, R2, Stripe Connect)
   - `/` หน้าแนะนำและดาวน์โหลดแอป
   - `/community` ร้าน wallpaper (ฟรีและเสียเงิน)
3. **สัญญาระหว่างแอปกับเว็บ** (เอกสารนี้) — ทั้งสองฝั่งต้องยึดตามนี้

---

## Wallpaper package (MVP)

- ไฟล์เดียว: `index.html` แบบ self-contained (inline JS/CSS, asset แปลงเป็น data URI) ขนาด **≤ 10 MB**
- ภาพปก: PNG/JPEG/WebP ขนาด **≤ 2 MB** (แนะนำ 1600×1000)
- wallpaper ฟังเมาส์ผ่าน DOM event มาตรฐาน (`mousemove`, `mousedown`, `mouseup`, `click`, `pointer*`)
- ถ้าจะรับสีจากแอป ให้ประกาศ `window.setP = ({c1,c2,c3,speed}) => …` (c* = `[r,g,b]` ค่า 0..1)
- **ห้ามใช้ network** ตอนรันในแอป: แอปบล็อกทุก request ที่ไม่ใช่ `file:`/`data:`/`blob:`

## Security model

| ภัย | การป้องกัน |
|---|---|
| ไฟล์ถูกแก้ระหว่างทาง / เซิร์ฟเวอร์ถูกเจาะ | เซิร์ฟเวอร์เซ็น manifest ด้วย **Ed25519** แอปตรวจลายเซ็นด้วย public key ที่ฝังในแอป และตรวจ SHA-256 ของไฟล์ก่อนติดตั้ง |
| wallpaper ส่งข้อมูลออก / ติดตามผู้ใช้ / โหลดโค้ดภายนอก | แอปใช้ `WKContentRuleList` บล็อกทุก URL ที่ไม่ใช่ local, ไม่มี JS↔native bridge (ยกเว้นการส่งเคอร์เซอร์เข้าไปทางเดียว), อ่านไฟล์ได้เฉพาะโฟลเดอร์ของตัวเอง |
| HTML อันตรายบนเว็บ (XSS ต่อผู้ใช้เว็บ) | ไม่ render HTML ที่อัปโหลดบน origin หลักเด็ดขาด ตัวอย่างสดแสดงใน `<iframe sandbox="allow-scripts">` (ไม่มี `allow-same-origin`) ที่เสิร์ฟจาก path `/preview/:id` พร้อม CSP `sandbox allow-scripts; default-src 'self' data: blob: 'unsafe-inline'; connect-src 'none'` |
| ไฟล์ปลอม / ใหญ่เกิน | ตรวจ magic bytes ของภาพ, จำกัดขนาด, ต้องมี `<html` ใน index.html, คำนวณ SHA-256 ฝั่งเซิร์ฟเวอร์ |
| wallpaper อันตรายหลุดขึ้นร้าน | ทุกชิ้นเริ่มที่สถานะ `pending` → admin ตรวจและกดอนุมัติก่อนขึ้นร้าน; scanner แจ้งเตือนคำที่น่าสงสัย (`fetch(`, `XMLHttpRequest`, `WebSocket`, `eval(`, `importScripts`, URL ภายนอก) ให้ admin เห็น |
| บัญชีถูกยึด | รหัสผ่าน PBKDF2-SHA256 (≥ 210,000 รอบ, salt สุ่ม), session cookie `HttpOnly; Secure; SameSite=Lax`, ตรวจ `Origin` ทุก POST, rate limit login/register/upload |
| ดาวน์โหลดของเสียเงินโดยไม่จ่าย | ไฟล์อยู่ใน R2 แบบ private เท่านั้น ดาวน์โหลดผ่าน Worker ที่ตรวจสิทธิ์ (ฟรี / ซื้อแล้ว / เป็นเจ้าของ) |
| ปลอม webhook การจ่ายเงิน | ตรวจลายเซ็น `Stripe-Signature` ทุกครั้ง, idempotent ตาม `event.id` |

## Money flow (Stripe Connect)

- ผู้สร้างผูกบัญชี Stripe ผ่าน onboarding (connected account)
- ผู้ซื้อจ่ายผ่าน Stripe Checkout แบบ destination charge
- แพลตฟอร์มหัก `application_fee_amount = price × PLATFORM_FEE_PERCENT / 100` (ค่าเริ่มต้น **20%**) ส่วนที่เหลือโอนให้ผู้สร้าง
- ราคาเป็น THB หน่วยสตางค์ (`price_cents`), 0 = ฟรี, ขั้นต่ำของที่เสียเงิน 20 บาท
- ระหว่างพัฒนาใช้ Stripe **test mode** เท่านั้น

## HTTP API (Worker, base `https://<host>`)

JSON ทั้งหมด, error = `{ "error": { "code": string, "message": string } }`

### Public
- `GET /api/wallpapers?sort=new|popular&q=&tag=&cursor=` →
  `{ items: WallpaperSummary[], next: string|null }`
- `GET /api/wallpapers/:id` → `WallpaperDetail`
- `GET /api/wallpapers/:id/manifest` → `SignedManifest` (เฉพาะสถานะ approved)
- `GET /api/wallpapers/:id/thumb` → ภาพปก
- `GET /preview/:id` → index.html สำหรับ iframe sandbox (approved เท่านั้น หรือเจ้าของ/admin)

### Auth (เว็บใช้ cookie, แอปใช้ `Authorization: Bearer <token>`)
- `POST /api/auth/register {email, password, displayName}`
- `POST /api/auth/login {email, password}`
- `POST /api/auth/logout`
- `GET /api/me` → `{ id, email, displayName, role: "user"|"admin", creator: { connected: bool, payoutsEnabled: bool } }`
- `GET /app/connect` (หน้าเว็บ ต้องล็อกอิน) → ผู้ใช้กดยืนยัน → สร้าง API token → redirect ไป
  `macwallpaperpro://auth?token=<token>` (token เก็บใน D1 แบบ SHA-256 hash, อายุ 90 วัน, ยกเลิกได้)

### Download (ฟรี: ไม่ต้องล็อกอิน; เสียเงิน: ต้องซื้อแล้ว)
- `GET /api/wallpapers/:id/download` → ไบต์ของ index.html (`application/octet-stream`),
  header `X-Content-SHA256`. ไม่มีสิทธิ์ → 402 `{error:{code:"payment_required"}}`

### Creator
- `POST /api/wallpapers` (multipart: `title`, `description`, `tags` (comma), `price_cents`, `file` (index.html), `thumb`) → `{ id, status: "pending" }`
- `GET /api/me/wallpapers` → wallpaper ของฉันพร้อมสถานะ
- `POST /api/creator/onboard` → `{ url }` (Stripe onboarding link)
- `GET /api/creator/earnings` → ยอดขาย

### Buyer
- `POST /api/wallpapers/:id/checkout` → `{ url }` (Stripe Checkout)
- `GET /api/me/library` → `WallpaperSummary[]` ที่ซื้อแล้ว/ฟรีที่เคยโหลด
- `POST /api/stripe/webhook` (Stripe เรียก)

### Admin
- `GET /api/admin/queue` → pending พร้อมผล scanner
- `POST /api/admin/wallpapers/:id/approve` / `reject {reason}`

### Types
```ts
WallpaperSummary = { id: string, title: string, author: { id: string, name: string },
  priceCents: number, currency: "thb", thumbUrl: string, downloads: number, tags: string[],
  createdAt: string }
WallpaperDetail = WallpaperSummary & { description: string, version: number, sizeBytes: number,
  sha256: string, owned: boolean, status: "pending"|"approved"|"rejected" }
SignedManifest = { id: string, version: number, sha256: string /* hex */, sizeBytes: number,
  title: string, author: string, signature: string /* base64 Ed25519 */ }
```

### Manifest signature
ข้อความที่เซ็น (UTF-8, คั่นด้วย `\n`, ไม่มี newline ท้าย):
```
macwallpaperpro-manifest-v1
<id>
<version>
<sha256 hex lowercase>
<sizeBytes>
```
- Public key (raw 32 bytes, base64): `4ACj7B0U1mZeAEoA9oiCy4JPSu3xO/CMuQqvRDYX604=`
- Private key (PKCS#8 DER base64) อยู่ที่ `secrets/signing-private-pkcs8.b64` → Worker secret `SIGNING_KEY_PKCS8`

## Deep links (แอปลงทะเบียน URL scheme `macwallpaperpro`)
- `macwallpaperpro://install?id=<id>` — ปุ่ม "ใช้ใน MacWallpaperPro" บนเว็บ
- `macwallpaperpro://auth?token=<token>` — หลังเชื่อมบัญชี

## การติดตั้งในแอป
`~/Library/Application Support/MacWallpaperPro/Wallpapers/<id>/index.html` + `manifest.json`
ขั้นตอน: ดึง manifest → ตรวจลายเซ็น → ดาวน์โหลด → ตรวจขนาดและ SHA-256 → เขียนไฟล์แบบ atomic → แสดงในแกลเลอรีของแอป
