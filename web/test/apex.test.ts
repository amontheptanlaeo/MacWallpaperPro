import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const SITE = { SITE_URL: "https://macwallpaper.elizos.com", ADSENSE_CLIENT: "ca-pub-5873755708069276" };

async function get(url: string) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, { redirect: "manual" }) as never, { ...env, ...SITE } as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("root domain (elizos.com)", () => {
  it("serves ads.txt itself", async () => {
    const res = await get("https://elizos.com/ads.txt");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("google.com, pub-5873755708069276, DIRECT, f08c47fec0942fa0\n");
  });

  it("serves an AdSense-verifiable page at / that forwards to the site", async () => {
    const html = await (await get("https://elizos.com/")).text();
    expect(html).toContain('<meta name="google-adsense-account" content="ca-pub-5873755708069276">');
    expect(html).toContain('http-equiv="refresh" content="0;url=https://macwallpaper.elizos.com/"');
  });

  it("301-redirects other paths, keeping path and query", async () => {
    const res = await get("https://www.elizos.com/community?cat=cute");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("https://macwallpaper.elizos.com/community?cat=cute");
  });

  it("never redirects to another host (//host paths)", async () => {
    for (const path of ["//example.org", "//example.org/x?y=1", "///example.org", "/\\example.org"]) {
      const res = await get("https://elizos.com" + path);
      expect(res.status).toBe(301);
      expect(new URL(res.headers.get("Location")!).origin).toBe("https://macwallpaper.elizos.com");
    }
  });

  it("leaves the main site alone", async () => {
    const res = await get("https://macwallpaper.elizos.com/ads.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });
});
