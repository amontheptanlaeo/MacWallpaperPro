import { HttpError } from "./http";

export const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_THUMB_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_UPLOAD_BODY = MAX_HTML_BYTES + MAX_THUMB_BYTES + 256 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60 MB (docs/ARCHITECTURE.md)
export const MAX_CREDIT = 120;
export const MAX_LICENSE = 80;
export const MAX_SOURCE_URL = 500;
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

export type WallpaperKind = "html" | "video";
export const KINDS = ["html", "video"] as const;
export function isKind(v: string): v is WallpaperKind {
  return v === "html" || v === "video";
}

/**
 * MP4 / MOV (ISO base media file format): the file starts with a box whose type is "ftyp"
 * (bytes 4..7). QuickTime files may start with "moov"/"wide"/"free"/"mdat" instead, but every
 * encoder we target (ffmpeg, AVFoundation, HandBrake) writes "ftyp" first, so that is required.
 * The 4-byte major brand that follows must be printable ASCII. Needs only the first 12 bytes.
 */
export function sniffVideo(b: Uint8Array): boolean {
  if (b.length < 12) return false;
  const size = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if (size !== 1 && size < 12) return false; // 1 = 64-bit size follows
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false; // "ftyp"
  for (let i = 8; i < 12; i++) if (b[i] < 0x20 || b[i] > 0x7e) return false;
  return true;
}

export function isSha256Hex(s: string): boolean {
  return /^[0-9a-f]{64}$/.test(s);
}

/** Attribution required for every video (the uploader must also confirm the rights). */
export function validateVideoMeta(fields: { credit: string; license: string; sourceUrl: string; rights: string }) {
  const credit = fields.credit.trim();
  if (!credit || [...credit].length > MAX_CREDIT || /[\u0000-\u001f]/.test(credit))
    throw bad("invalid_credit", `Say who made the video (up to ${MAX_CREDIT} characters).`);
  const license = fields.license.trim();
  if (!license || [...license].length > MAX_LICENSE || /[\u0000-\u001f]/.test(license))
    throw bad("invalid_license", `Name the license (up to ${MAX_LICENSE} characters), e.g. "CC0 1.0".`);
  const rawUrl = fields.sourceUrl.trim();
  let sourceUrl: string | null = null;
  if (rawUrl) {
    let u: URL | null = null;
    try {
      u = new URL(rawUrl);
    } catch {
      u = null;
    }
    if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || rawUrl.length > MAX_SOURCE_URL || u.username || u.password)
      throw bad("invalid_source_url", "The source link must be an http(s) address.");
    sourceUrl = u.href;
  }
  if (!["on", "true", "1", "yes"].includes(fields.rights.trim().toLowerCase()))
    throw bad("rights_required", "Confirm that you own this video or that it is public domain/CC0.");
  return { credit, license, sourceUrl };
}

export function validateHtml(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) throw bad("invalid_file", "index.html is empty.");
  if (bytes.byteLength > MAX_HTML_BYTES) throw new HttpError(413, "file_too_large", "index.html must be 10 MB or smaller.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw bad("invalid_file", "index.html must be UTF-8 text.");
  }
  if (!/<html[\s>]/i.test(text)) throw bad("invalid_file", "This is not an HTML file (no <html> tag).");
  return text;
}

export function validateThumb(bytes: Uint8Array): ImageType {
  if (bytes.byteLength === 0) throw bad("invalid_thumb", "Attach a thumbnail.");
  if (bytes.byteLength > MAX_THUMB_BYTES) throw new HttpError(413, "thumb_too_large", "The thumbnail must be 2 MB or smaller.");
  const t = sniffImage(bytes);
  if (!t) throw bad("invalid_thumb", "The thumbnail must be PNG, JPEG or WebP.");
  return t;
}

export function normalizeTags(raw: string): string[] {
  const tags = raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
  const uniq = [...new Set(tags)];
  if (uniq.length > MAX_TAGS) throw bad("invalid_tags", `Use at most ${MAX_TAGS} tags.`);
  for (const t of uniq) {
    if (t.length > MAX_TAG_LEN || /[,<>"'`]/.test(t))
      throw bad("invalid_tags", `Tag "${t.slice(0, 30)}" is longer than ${MAX_TAG_LEN} characters or has invalid characters.`);
  }
  return uniq;
}

export const CATEGORIES = ["cute", "nature", "cartoon", "space", "scifi", "abstract"] as const;
export type Category = (typeof CATEGORIES)[number];
export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

export function validateMeta(fields: { title: string; description: string; category: string }) {
  const title = fields.title.trim();
  if (!title) throw bad("invalid_title", "Give the wallpaper a title.");
  if ([...title].length > MAX_TITLE || /[\u0000-\u001f]/.test(title)) throw bad("invalid_title", `Titles are limited to ${MAX_TITLE} characters.`);
  const description = fields.description.trim();
  if ([...description].length > MAX_DESCRIPTION) throw bad("invalid_description", `Descriptions are limited to ${MAX_DESCRIPTION} characters.`);
  const category = fields.category.trim().toLowerCase();
  if (!isCategory(category)) throw bad("invalid_category", "Choose one of the listed categories.");
  return { title, description, category };
}

// ---------------------------------------------------------------------------
// Suspicious-pattern scanner. ADVISORY ONLY: findings never block an upload; they
// are shown to the admin in the moderation queue. A clean result is NOT proof of
// safety (obfuscation can always get past a regex). The real controls are human
// moderation, the preview CSP and the app's network-blocking rule list.
// Wallpapers run offline in the app, so any network or dynamic-code API is a red
// flag worth a closer look.
// ---------------------------------------------------------------------------
export interface ScanFinding {
  id: string;
  label: string;
  severity: "high" | "medium" | "low";
  count: number;
  samples: { line: number; excerpt: string }[];
}

const RULES: { id: string; severity: ScanFinding["severity"]; re: string }[] = [
  { id: "fetch", severity: "high", re: String.raw`\bfetch\s*\(` },
  { id: "xhr", severity: "high", re: String.raw`\bXMLHttpRequest\b` },
  { id: "websocket", severity: "high", re: String.raw`\bWebSocket\b` },
  { id: "eventsource", severity: "high", re: String.raw`\bEventSource\b` },
  { id: "beacon", severity: "high", re: String.raw`\bsendBeacon\b` },
  { id: "eval", severity: "high", re: String.raw`\beval\s*\(` },
  { id: "function_ctor", severity: "high", re: String.raw`\bnew\s+Function\s*\(` },
  { id: "import_scripts", severity: "high", re: String.raw`\bimportScripts\b` },
  { id: "dynamic_import", severity: "medium", re: String.raw`\bimport\s*\(` },
  { id: "string_timer", severity: "medium", re: String.raw`\bset(?:Timeout|Interval)\s*\(\s*["'\x60]` },
  { id: "cookie", severity: "medium", re: String.raw`\bdocument\.cookie\b` },
  { id: "window_open", severity: "medium", re: String.raw`\bwindow\.open\s*\(|\btop\.location\b` },
  { id: "embed", severity: "medium", re: String.raw`<\s*(?:iframe|object|embed|form)\b` },
  { id: "worker", severity: "low", re: String.raw`\bnew\s+(?:Shared)?Worker\s*\(|\bserviceWorker\b` },
  // Common evasions: names built from string pieces ("fet"+"ch", 'ev'+'al'), bare Function(),
  // bracket access on the global object, base64-decoded code, navigation and redirects.
  { id: "obfuscated_name", severity: "high", re: String.raw`["'\x60](?:fe|fet|fetc|ev|eva|Fu|Fun|Func|Funct|Functi|Functio|XM|XML|XMLH|We|Web|WebS|Webs|imp|impo|impor|at|ato|sendB)["'\x60]\s*\+\s*["'\x60]` },
  { id: "function_call", severity: "high", re: String.raw`(?<![\w$.])Function\s*\(` },
  { id: "global_bracket", severity: "medium", re: String.raw`\b(?:window|globalThis|self|top|parent|frames)\s*\[` },
  { id: "atob", severity: "medium", re: String.raw`\batob\s*\(` },
  { id: "location", severity: "medium", re: String.raw`\blocation(?:\s*\.\s*href)?\s*=(?!=)|\blocation\s*\.\s*(?:assign|replace)\s*\(` },
  { id: "meta_refresh", severity: "medium", re: String.raw`<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh` },
  { id: "base_tag", severity: "medium", re: String.raw`<\s*base\b` },
  // External URLs (http/https/ws/protocol-relative); XML namespace ids and bare "//" comments are filtered below.
  { id: "external_url", severity: "high", re: String.raw`(?:(?:https?|wss?):)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}[^\s"'<>)]*` },
];

// One combined regex => a single pass over the file, which keeps CPU low for large uploads.
const COMBINED = new RegExp(RULES.map((r, i) => `(?<r${i}>${r.re})`).join("|"), "gi");
const CASE_SENSITIVE = new Set(["xhr", "websocket", "eventsource", "beacon", "import_scripts", "cookie", "worker", "fetch", "eval", "function_ctor", "dynamic_import", "string_timer", "window_open", "obfuscated_name", "function_call", "global_bracket", "atob", "location"]);
const EXACT = RULES.map((r) => new RegExp(r.re));
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
  const lineOf = lineIndex(text);
  const hits = new Map<number, { count: number; samples: { line: number; excerpt: string }[] }>();
  for (const m of text.matchAll(COMBINED)) {
    const g = m.groups!;
    let ri = -1;
    for (let i = 0; i < RULES.length; i++) if (g[`r${i}`] !== undefined) { ri = i; break; }
    if (ri < 0) continue;
    const rule = RULES[ri];
    const s = m[0];
    // JS identifiers are case-sensitive; the combined regex is not.
    if (CASE_SENSITIVE.has(rule.id) && !EXACT[ri].test(s)) continue;
    if (rule.id === "external_url") {
      if (NAMESPACE_ALLOW.test(s)) continue;
      if (!/^(?:https?|wss?):/i.test(s) && !isUrlContext(text, m.index!)) continue;
    }
    let h = hits.get(ri);
    if (!h) hits.set(ri, (h = { count: 0, samples: [] }));
    h.count++;
    if (h.samples.length < 3) h.samples.push({ line: lineOf(m.index!), excerpt: excerpt(text, m.index!, s.length) });
  }
  return [...hits.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ri, h]) => ({ id: RULES[ri].id, label: RULES[ri].id, severity: RULES[ri].severity, count: h.count, samples: h.samples }));
}

function isUrlContext(text: string, index: number): boolean {
  // protocol-relative URL only counts inside an attribute/string or url(...)
  const prev = text.slice(Math.max(0, index - 6), index);
  return /["'(=]\s*$/.test(prev);
}
