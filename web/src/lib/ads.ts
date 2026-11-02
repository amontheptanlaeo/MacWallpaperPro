// Google AdSense (website only; the app never shows ads).
// Nothing ad-related is emitted unless ADSENSE_CLIENT and the slot id are valid: no markup, no
// placeholder box, no ad CSP, no consent banner.
import { escapeHtml } from "./http";
import type { T } from "./i18n";

export type SlotName = "browse" | "detail" | "footer";

export interface AdConfig {
  client: string; // ca-pub-XXXXXXXXXXXXXXXX
  slots: Partial<Record<SlotName, string>>;
}

const CLIENT_RE = /^ca-pub-\d{10,20}$/;
const SLOT_RE = /^\d{5,20}$/;

export function adConfig(env: Env): AdConfig | null {
  const client = String(env.ADSENSE_CLIENT || "").trim();
  if (!CLIENT_RE.test(client)) return null;
  const slots: AdConfig["slots"] = {};
  const raw: Record<SlotName, unknown> = { browse: env.ADSENSE_SLOT_BROWSE, detail: env.ADSENSE_SLOT_DETAIL, footer: env.ADSENSE_SLOT_FOOTER };
  for (const k of Object.keys(raw) as SlotName[]) {
    const v = String(raw[k] || "").trim();
    if (SLOT_RE.test(v)) slots[k] = v;
  }
  return { client, slots };
}

/** True when the page will render at least one of the given slots (decides the CSP). */
export function pageHasAds(cfg: AdConfig | null, names: SlotName[]): boolean {
  return !!cfg && names.some((n) => cfg.slots[n]);
}

/**
 * One responsive ad unit. The wrapper reserves height only once configured (to limit CLS) and hides
 * itself if AdSense reports the slot unfilled (see assets/js/ads.js).
 */
export function adSlot(cfg: AdConfig | null, name: SlotName, t: T): string {
  const slot = cfg?.slots[name];
  if (!cfg || !slot) return "";
  return `<aside class="ad ad--${name}" data-ad aria-label="${escapeHtml(t("ad.label"))}">
  <span class="ad__label">${escapeHtml(t("ad.label"))}</span>
  <ins class="adsbygoogle ad__unit" data-ad-client="${escapeHtml(cfg.client)}" data-ad-slot="${escapeHtml(slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>
</aside>`;
}

/** ads.txt body for the configured publisher (Google's certification authority id is fixed). */
export function adsTxt(env: Env): string | null {
  const cfg = adConfig(env);
  if (!cfg) return null;
  return `google.com, ${cfg.client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`;
}

/** Site-ownership verification for AdSense — on every page once a publisher id is set (no script, no CSP change). */
export function adsenseMeta(env: Env): string {
  const cfg = adConfig(env);
  return cfg ? `<meta name="google-adsense-account" content="${escapeHtml(cfg.client)}">` : "";
}
