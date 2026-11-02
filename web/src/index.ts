import { checkOrigin } from "./lib/auth";
import { errorResponse, HttpError } from "./lib/http";
import * as admin from "./routes/admin";
import * as creator from "./routes/creator";
import * as pub from "./routes/public";
import * as site from "./routes/site";

type Handler = (request: Request, env: Env, ctx: ExecutionContext, params: string[]) => Promise<Response> | Response;
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
  // Public API (used by the macOS app; no account ever needed)
  r("GET", "/api/wallpapers", (q, e) => pub.listWallpapers(q, e)),
  r("GET", "/api/categories", (_q, e) => pub.listCategories(e)),
  r("GET", "/api/wallpapers/:id", (q, e, _c, [id]) => pub.getWallpaper(q, e, id)),
  r("GET", "/api/wallpapers/:id/manifest", (_q, e, _c, [id]) => pub.getManifest(e, id)),
  r("GET", "/api/wallpapers/:id/thumb", (q, e, _c, [id]) => pub.getThumb(q, e, id)),
  r("GET", "/api/wallpapers/:id/download", (q, e, c, [id]) => pub.downloadWallpaper(q, e, c, id)),
  r("GET", "/preview-sandbox", () => pub.previewSandbox()),
  r("GET", "/preview/:id", (q, e, _c, [id]) => pub.getPreview(q, e, id)),
  // Account (creators/admins only)
  r("GET", "/api/me", (q, e) => site.me(q, e)),
  r("POST", "/api/auth/logout", (q, e) => site.logout(q, e)),
  r("GET", "/auth/(google|github)/start", (q, e, _c, [p]) => site.oauthStart(q, e, p)),
  r("GET", "/auth/(google|github)/callback", (q, e, _c, [p]) => site.oauthCallback(q, e, p)),
  r("POST", "/auth/dev", (q, e) => site.devLogin(q, e)),
  // Creator
  r("POST", "/api/wallpapers", (q, e) => creator.uploadWallpaper(q, e)),
  r("GET", "/api/me/wallpapers", (q, e) => creator.myWallpapers(q, e)),
  // Admin
  r("GET", "/api/admin/queue", (q, e) => admin.queue(q, e)),
  r("POST", "/api/admin/wallpapers/:id/approve", (q, e, _c, [id]) => admin.review(q, e, id, "approve")),
  r("POST", "/api/admin/wallpapers/:id/reject", (q, e, _c, [id]) => admin.review(q, e, id, "reject")),
  // Pages
  r("GET", "/", (q, e) => site.landing(q, e)),
  r("GET", "/community/?", (q, e) => site.browse(q, e)),
  r("GET", "/community/w/:id/?", (q, e, _c, [id]) => site.detail(q, e, id)),
  r("GET", "/community/upload/?", (q, e) => site.upload(q, e)),
  r("GET", "/community/mine/?", (q, e) => site.mine(q, e)),
  r("GET", "/community/admin/?", (q, e) => site.admin(q, e)),
  r("GET", "/signin/?", (q, e) => site.signin(q, e)),
  r("GET", "/privacy/?", (q, e) => site.privacy(q, e)),
  r("GET", "/lang/([A-Za-z-]{2,7})", (q, _e, _c, [code]) => site.setLanguage(q, code)),
  r("GET", "/download/?", (q, e) => site.downloadApp(q, e)),
  r("GET", "/ads.txt", (_q, e) => site.adsTxtRoute(e)),
  r("GET", "/robots.txt", (q, e) => site.robots(q, e)),
  r("GET", "/sitemap.xml", (q, e) => site.sitemap(q, e)),
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
    checkOrigin(request, env);
    return rt.handler(request, env, ctx, m.slice(1));
  }
  if (pathMatched) throw new HttpError(405, "method_not_allowed", "Method not allowed.");
  if (url.pathname.startsWith("/api/")) throw new HttpError(404, "not_found", "No such endpoint.");
  // Static files are normally served before the Worker runs; this covers anything else.
  const asset = await env.ASSETS.fetch(request);
  if (asset.status !== 404) return asset;
  return site.notFound(request, env);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      const url = new URL(request.url);
      if (e instanceof HttpError) return errorResponse(e.status, e.code, e.message, e.headers);
      console.error(JSON.stringify({ msg: "unhandled_error", path: url.pathname, error: String((e as Error)?.stack ?? e) }));
      return errorResponse(500, "internal_error", "Internal server error.");
    }
  },
} satisfies ExportedHandler<Env>;
