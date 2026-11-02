import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(here("./migrations"));
  // Real signing key so the test can verify against the public key in docs/ARCHITECTURE.md.
  const signingKey = readFileSync(here("../secrets/signing-private-pkcs8.b64"), "utf8").trim();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SIGNING_KEY_PKCS8: signingKey,
            ENVIRONMENT: "development",
            ADMIN_EMAILS: "admin@example.com",
            // Fake OAuth apps; every provider call is mocked in test/oauth.test.ts.
            GOOGLE_CLIENT_ID: "google-test-client",
            GOOGLE_CLIENT_SECRET: "google-test-secret",
            GITHUB_CLIENT_ID: "github-test-client",
            GITHUB_CLIENT_SECRET: "github-test-secret",
            ADSENSE_CLIENT: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      testTimeout: 30_000,
    },
  };
});
