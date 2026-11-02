import { HttpError } from "./http";

export const MAX_HTML_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_THUMB_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_UPLOAD_BODY = MAX_HTML_BYTES + MAX_THUMB_BYTES + 256 * 1024;
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
  // External URLs (http/https/ws/protocol-relative); XML namespace ids and bare "//" comments are filtered below.
  { id: "external_url", severity: "high", re: String.raw`(?:(?:https?|wss?):)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}[^\s"'<>)]*` },
];

// One combined regex => a single pass over the file, which keeps CPU low for large uploads.
const COMBINED = new RegExp(RULES.map((r, i) => `(?<r${i}>${r.re})`).join("|"), "gi");
const CASE_SENSITIVE = new Set(["xhr", "websocket", "eventsource", "beacon", "import_scripts", "cookie", "worker", "fetch", "eval", "function_ctor", "dynamic_import", "string_timer", "window_open"]);
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
