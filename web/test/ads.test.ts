import { describe, expect, it } from "vitest";
import { SITE_CSP } from "../src/lib/http";
import { PREVIEW_CSP } from "../src/routes/public";
import { callWith, insertWallpaper, signedInUser } from "./helpers";

const ADS = {
  ADSENSE_CLIENT: "ca-pub-1234567890123456",
  ADSENSE_SLOT_BROWSE: "1111111111",
  ADSENSE_SLOT_DETAIL: "2222222222",
  ADSENSE_SLOT_FOOTER: "3333333333",
};
const NO_ADS = { ADSENSE_CLIENT: "", ADSENSE_SLOT_BROWSE: "", ADSENSE_SLOT_DETAIL: "", ADSENSE_SLOT_FOOTER: "" };
const AD_HOST = /googlesyndication|doubleclick|adtrafficquality/;

describe("AdSense", () => {
  it("renders nothing ad-related when not configured (no markup, no ad CSP, no banner, no ads.txt)", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    for (const path of ["/", "/community", `/community/w/${wp.id}`]) {
      const res = await callWith(NO_ADS, path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Security-Policy"), path).toBe(SITE_CSP);
      const html = await res.text();
      expect(html).not.toContain("adsbygoogle");
      expect(html).not.toContain("data-ad");
      expect(html).not.toContain("data-consent");
      expect(html).not.toContain("/assets/js/ads.js");
    }
    expect((await callWith(NO_ADS, "/ads.txt")).status).toBe(404);
    // A bad publisher id counts as "not configured".
    expect((await callWith({ ...ADS, ADSENSE_CLIENT: "pub-123" }, "/")).headers.get("Content-Security-Policy")).toBe(SITE_CSP);
  });

  it("allows Google ad hosts only on pages that show an ad slot", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    for (const path of ["/", "/community", `/community/w/${wp.id}`]) {
      const res = await callWith(ADS, path);
      const csp = res.headers.get("Content-Security-Policy")!;
      expect(csp, path).toMatch(AD_HOST);
      expect(csp).toContain("https://*.google");
      expect(csp).toContain("frame-ancestors 'none'");
      const html = await res.text();
      expect(html).toContain('class="adsbygoogle');
      expect(html).toContain('data-ad-client="ca-pub-1234567890123456"');
      expect(html).toContain("data-consent"); // consent banner, denied by default until accepted
    }
    // Pages without ad slots keep the strict policy even with AdSense configured.
    for (const path of ["/community/upload", "/signin", "/privacy"]) {
      const res = await callWith(ADS, path);
      expect(res.headers.get("Content-Security-Policy"), path).toBe(SITE_CSP);
      expect(await res.text()).not.toContain('class="adsbygoogle');
    }
    // Only the slots that are configured make a page an "ad page".
    const onlyFooter = await callWith({ ...ADS, ADSENSE_SLOT_BROWSE: "" }, "/community");
    expect(onlyFooter.headers.get("Content-Security-Policy")).toBe(SITE_CSP);
  });

  it("keeps the wallpaper preview fully locked down even with ads on", async () => {
    const owner = await signedInUser();
    const wp = await insertWallpaper({ ownerId: owner.id });
    for (const path of [`/preview/${wp.id}`, "/preview-sandbox"]) {
      const csp = (await callWith(ADS, path)).headers.get("Content-Security-Policy")!;
      expect(csp).toBe(PREVIEW_CSP);
      expect(csp).not.toMatch(AD_HOST);
    }
  });

  it("generates ads.txt from the publisher id", async () => {
    const res = await callWith(ADS, "/ads.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
  });

  it("consent banner starts visible and stays hidden once a choice is stored", async () => {
    const fresh = await (await callWith(ADS, "/")).text();
    expect(fresh).toMatch(/<div class="consent" data-consent[^>]*role="region"[^>]*>/);
    expect(fresh).not.toMatch(/data-consent role="region" aria-labelledby="consent-title" hidden/);
    const decided = await (await callWith(ADS, "/", { cookie: "mwp_consent=denied" })).text();
    expect(decided).toMatch(/data-consent role="region" aria-labelledby="consent-title" hidden/);
  });
});
