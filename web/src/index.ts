import { checkOrigin } from "./lib/auth";
import { errorResponse, HttpError } from "./lib/http";
import * as admin from "./routes/admin";
import * as auth from "./routes/auth";
import * as buyer from "./routes/buyer";
import * as creator from "./routes/creator";
import * as pages from "./routes/pages";
import * as pub from "./routes/public";

type Handler = (request: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const ID = "([a-z0-9][a-z0-9-]{2,39})";
const r = (method: string, path: string, handler: Handler): Route => ({
  method,
  pattern: new RegExp("^" + path.replace(/:id/g, ID) + "$"),
  handler,
});

const routes: Route[] = [
  // Public
  r("GET", "/api/wallpapers", (q, e) => pub.listWallpapers(q, e)),
  r("GET", "/api/wallpapers/:id", (q, e, _c, [id]) => pub.getWallpaper(q, e, id)),
  r("GET", "/api/wallpapers/:id/manifest", (_q, e, _c, [id]) => pub.getManifest(e, id)),
  r("GET", "/api/wallpapers/:id/thumb", (q, e, _c, [id]) => pub.getThumb(q, e, id)),
  r("GET", "/api/wallpapers/:id/download", (q, e, c, [id]) => pub.downloadWallpaper(q, e, c, id)),
  r("GET", "/preview/:id", (q, e, _c, [id]) => pub.getPreview(q, e, id)),
  // Auth
  r("POST", "/api/auth/register", (q, e) => auth.register(q, e)),
  r("POST", "/api/auth/login", (q, e) => auth.login(q, e)),
  r("POST", "/api/auth/logout", (q, e) => auth.logout(q, e)),
  r("GET", "/api/me", (q, e) => auth.me(q, e)),
  r("GET", "/api/me/tokens", (q, e) => auth.listTokens(q, e)),
  r("POST", "/api/me/tokens/([0-9a-f-]{36})/revoke", (q, e, _c, [id]) => auth.revokeToken(q, e, id)),
  // Creator
  r("POST", "/api/wallpapers", (q, e) => creator.uploadWallpaper(q, e)),
  r("GET", "/api/me/wallpapers", (q, e) => creator.myWallpapers(q, e)),
  r("POST", "/api/creator/onboard", (q, e) => creator.onboard(q, e)),
  r("GET", "/api/creator/earnings", (q, e) => creator.earnings(q, e)),
  // Buyer
  r("POST", "/api/wallpapers/:id/checkout", (q, e, _c, [id]) => buyer.checkout(q, e, id)),
  r("GET", "/api/me/library", (q, e) => buyer.library(q, e)),
  r("POST", "/api/stripe/webhook", (q, e) => buyer.stripeWebhook(q, e)),
  // Admin
  r("GET", "/api/admin/queue", (q, e) => admin.queue(q, e)),
  r("POST", "/api/admin/wallpapers/:id/approve", (q, e, _c, [id]) => admin.review(q, e, id, "approve")),
  r("POST", "/api/admin/wallpapers/:id/reject", (q, e, _c, [id]) => admin.review(q, e, id, "reject")),
  // Pages served by the Worker
  r("GET", "/download", (_q, e) => pages.downloadApp(e)),
  r("GET", "/app/connect", (q, e) => pages.connectPage(q, e)),
  r("POST", "/app/connect", (q, e) => pages.connectSubmit(q, e)),
  r("GET", "/community/w/(?:[a-z0-9][a-z0-9-]{0,39})?/?", (q, e) => pages.wallpaperPage(q, e)),
];

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method === "HEAD" ? "GET" : request.method;
  let pathMatched = false;
  for (const rt of routes) {
    const m = rt.pattern.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (rt.method !== method) continue;
    // Stripe calls the webhook server-to-server (no Origin); it is authenticated by signature instead.
    if (url.pathname !== "/api/stripe/webhook") checkOrigin(request, env);
    return rt.handler(request, env, ctx, m.slice(1));
  }
  if (pathMatched) throw new HttpError(405, "method_not_allowed", "ไม่รองรับเมธอดนี้");
  if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "ไม่พบ endpoint นี้");
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      const url = new URL(request.url);
      if (e instanceof HttpError) {
        if (url.pathname === "/app/connect" && e.status === 401) {
          return new Response(null, { status: 302, headers: { Location: "/community/login?next=%2Fapp%2Fconnect" } });
        }
        return errorResponse(e.status, e.code, e.message, e.headers);
      }
      console.error(JSON.stringify({ msg: "unhandled_error", path: url.pathname, error: String((e as Error)?.stack ?? e) }));
      return errorResponse(500, "internal_error", "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์");
    }
  },
} satisfies ExportedHandler<Env>;
