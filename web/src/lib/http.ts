// Shared HTTP helpers: JSON responses, contract-shaped errors, security headers.

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

/** CSP for HTML pages rendered by the Worker on the main origin (same policy as public/_headers). */
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self'; " +
  "connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return json({ error: { code, message } }, status, headers);
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": SITE_CSP,
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 16 * 1024): Promise<T> {
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > maxBytes) throw new HttpError(413, "payload_too_large", "ข้อมูลที่ส่งมาใหญ่เกินไป");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", "ข้อมูลที่ส่งมาใหญ่เกินไป");
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new HttpError(400, "invalid_json", "รูปแบบ JSON ไม่ถูกต้อง");
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "local";
}
