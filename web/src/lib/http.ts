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

/**
 * HTTPS only, for a year, on the exact host that answered (browsers ignore it over plain HTTP).
 * Deliberately no includeSubDomains: this Worker also answers for the root elizos.com, and other
 * *.elizos.com services are not ours to force onto HSTS.
 */
export const HSTS = "max-age=31536000";

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": HSTS,
};

/**
 * Make sure every Worker response carries HSTS, including ones built elsewhere (Response.redirect,
 * plain-text routes, asset fallbacks), whose headers may be immutable.
 */
export function withHsts(res: Response): Response {
  if (res.headers.has("Strict-Transport-Security")) return res;
  try {
    res.headers.set("Strict-Transport-Security", HSTS);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.set("Strict-Transport-Security", HSTS);
    return copy;
  }
}

/** CSP for HTML pages on the main origin. Strict: no inline script, no third-party anything. */
export const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com; " +
  "media-src 'self' blob:; frame-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; " +
  "object-src 'none'; frame-ancestors 'none'";

/** Google AdSense hosts. Allowed ONLY on pages that actually render an ad slot. */
export const AD_HOSTS = [
  "https://pagead2.googlesyndication.com",
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.adtrafficquality.google",
  "https://*.google",
  "https://www.google.com",
  "https://*.google.com",
];

/** CSP for ad pages: the strict policy plus the AdSense hosts (and inline styles that ad iframes inject). */
export const ADS_CSP = (() => {
  const h = AD_HOSTS.join(" ");
  return (
    `default-src 'self'; script-src 'self' ${h}; style-src 'self' 'unsafe-inline'; font-src 'self'; ` +
    `img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self' ${h}; fenced-frame-src ${h}; ` +
    `connect-src 'self' ${h}; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'`
  );
})();

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

export function html(body: string, status = 200, headers: Record<string, string> = {}, opts: { ads?: boolean } = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "Vary": "Cookie, Accept-Language",
      "Content-Security-Policy": opts.ads ? ADS_CSP : SITE_CSP,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = 16 * 1024): Promise<T> {
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "payload_too_large", "Request body is too large.");
  if (!text) return {} as T;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON.");
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "local";
}
