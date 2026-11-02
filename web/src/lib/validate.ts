import { HttpError } from "./http";

export const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_THUMB_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_UPLOAD_BODY = MAX_HTML_BYTES + MAX_THUMB_BYTES + 256 * 1024;
export const MIN_PAID_CENTS = 2000; // 20 THB
export const MAX_PRICE_CENTS = 1_000_000; // 10,000 THB
export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 2000;
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

/** Identify an image purely by magic bytes; the client-declared type is ignored. */
export function sniffImage(b: Uint8Array): ImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const bad = (code: string, message: string) => new HttpError(400, code, message);

export function validateHtml(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw bad("invalid_file", "ไฟล์ index.html ว่างเปล่า");
  if (bytes.byteLength > MAX_HTML_BYTES) throw new HttpError(413, "file_too_large", "ไฟล์ index.html ต้องไม่เกิน 10 MB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw bad("invalid_file", "index.html ต้องเป็นข้อความ UTF-8");
  }
  if (!/<html[\s>]/i.test(text)) throw bad("invalid_file", "ไฟล์นี้ไม่ใช่ HTML (ต้องมีแท็ก <html>)");
  return text;
}

export function validateThumb(bytes: Uint8Array): ImageType {
  if (bytes.byteLength === 0) throw bad("invalid_thumb", "กรุณาแนบภาพปก");
  if (bytes.byteLength > MAX_THUMB_BYTES) throw new HttpError(413, "thumb_too_large", "ภาพปกต้องไม่เกิน 2 MB");
  const t = sniffImage(bytes);
  if (!t) throw bad("invalid_thumb", "ภาพปกต้องเป็นไฟล์ PNG, JPEG หรือ WebP");
  return t;
}

export function normalizeTags(raw: string): string[] {
  const tags = raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
  const uniq = [...new Set(tags)];
  if (uniq.length > MAX_TAGS) throw bad("invalid_tags", `ใส่แท็กได้ไม่เกิน ${MAX_TAGS} แท็ก`);
  for (const t of uniq) {
    if (t.length > MAX_TAG_LEN || /[,<>"'`]/.test(t))
      throw bad("invalid_tags", `แท็ก "${t.slice(0, 30)}" ยาวเกิน ${MAX_TAG_LEN} ตัวอักษรหรือมีอักขระที่ใช้ไม่ได้`);
  }
  return uniq;
}

export function validateMeta(fields: { title: string; description: string; price: string }) {
  const title = fields.title.trim();
  if (!title) throw bad("invalid_title", "กรุณาตั้งชื่อวอลเปเปอร์");
  if ([...title].length > MAX_TITLE) throw bad("invalid_title", `ชื่อยาวได้ไม่เกิน ${MAX_TITLE} ตัวอักษร`);
  const description = fields.description.trim();
  if ([...description].length > MAX_DESCRIPTION) throw bad("invalid_description", `คำอธิบายยาวได้ไม่เกิน ${MAX_DESCRIPTION} ตัวอักษร`);
  const priceStr = fields.price.trim() || "0";
  if (!/^\d+$/.test(priceStr)) throw bad("invalid_price", "ราคาต้องเป็นจำนวนเต็มหน่วยสตางค์");
  const priceCents = Number(priceStr);
  if (priceCents !== 0 && priceCents < MIN_PAID_CENTS) throw bad("invalid_price", "ของที่เสียเงินต้องราคาอย่างน้อย 20 บาท");
  if (priceCents > MAX_PRICE_CENTS) throw bad("invalid_price", "ราคาสูงสุด 10,000 บาท");
  return { title, description, priceCents };
}

// ---------------------------------------------------------------------------
// Suspicious-pattern scanner. Findings never block an upload; they are shown to
// the admin in the moderation queue. Wallpapers run offline in the app, so any
// network or dynamic-code API is a red flag worth a closer look.
// ---------------------------------------------------------------------------
export interface ScanFinding {
  id: string;
  label: string;
  severity: "high" | "medium" | "low";
  count: number;
  samples: { line: number; excerpt: string }[];
}

const RULES: { id: string; label: string; severity: ScanFinding["severity"]; re: RegExp }[] = [
  { id: "fetch", label: "เรียก fetch( — พยายามใช้เครือข่าย", severity: "high", re: /\bfetch\s*\(/g },
  { id: "xhr", label: "XMLHttpRequest — พยายามใช้เครือข่าย", severity: "high", re: /\bXMLHttpRequest\b/g },
  { id: "websocket", label: "WebSocket — เปิดการเชื่อมต่อภายนอก", severity: "high", re: /\bWebSocket\b/g },
  { id: "eventsource", label: "EventSource — รับข้อมูลจากเซิร์ฟเวอร์", severity: "high", re: /\bEventSource\b/g },
  { id: "beacon", label: "sendBeacon — ส่งข้อมูลออก", severity: "high", re: /\bsendBeacon\b/g },
  { id: "eval", label: "eval( — รันโค้ดจากข้อความ", severity: "high", re: /\beval\s*\(/g },
  { id: "function_ctor", label: "new Function( — รันโค้ดจากข้อความ", severity: "high", re: /\bnew\s+Function\s*\(/g },
  { id: "import_scripts", label: "importScripts — โหลดสคริปต์เพิ่ม", severity: "high", re: /\bimportScripts\b/g },
  { id: "dynamic_import", label: "import( — โหลดโมดูลแบบไดนามิก", severity: "medium", re: /\bimport\s*\(/g },
  { id: "string_timer", label: "setTimeout/setInterval ด้วยสตริง", severity: "medium", re: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g },
  { id: "cookie", label: "document.cookie", severity: "medium", re: /\bdocument\.cookie\b/g },
  { id: "window_open", label: "window.open / top.location — เปิดหน้าอื่น", severity: "medium", re: /\bwindow\.open\s*\(|\btop\.location\b/g },
  { id: "embed", label: "<iframe>/<object>/<embed>/<form>", severity: "medium", re: /<\s*(iframe|object|embed|form)\b/gi },
  { id: "worker", label: "Worker / ServiceWorker", severity: "low", re: /\bnew\s+(?:Shared)?Worker\s*\(|\bserviceWorker\b/g },
];

// External URLs (http/https/protocol-relative), excluding XML namespace identifiers.
const URL_RE = /(?:(?:https?|wss?):)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'<>)]*/gi;
const NAMESPACE_ALLOW = /^(?:https?:)?\/\/(?:www\.)?w3\.org\//i;

function lineIndex(text: string): (index: number) => number {
  let starts: number[] | null = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

function excerpt(text: string, index: number, len: number): string {
  const s = Math.max(0, index - 40);
  return text.slice(s, Math.min(text.length, index + len + 40)).replace(/\s+/g, " ").trim().slice(0, 160);
}

export function scanHtml(text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lineOf = lineIndex(text);
  const push = (id: string, label: string, severity: ScanFinding["severity"], matches: RegExpMatchArray[]) => {
    if (!matches.length) return;
    findings.push({
      id,
      label,
      severity,
      count: matches.length,
      samples: matches.slice(0, 3).map((m) => ({ line: lineOf(m.index!), excerpt: excerpt(text, m.index!, m[0].length) })),
    });
  };
  for (const r of RULES) push(r.id, r.label, r.severity, [...text.matchAll(r.re)]);
  const urls = [...text.matchAll(URL_RE)].filter((m) => {
    if (NAMESPACE_ALLOW.test(m[0])) return false;
    return /^(?:(?:https?|wss?):)?\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i.test(m[0]) && (/^(?:https?|wss?):/i.test(m[0]) || isUrlContext(text, m.index!));
  });
  push("external_url", "URL ภายนอก", "high", urls);
  return findings;
}

function isUrlContext(text: string, index: number): boolean {
  // protocol-relative URL only counts inside an attribute/string or url(...)
  const prev = text.slice(Math.max(0, index - 6), index);
  return /["'(=]\s*$/.test(prev);
}
