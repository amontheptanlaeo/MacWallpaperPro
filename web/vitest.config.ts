import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(async () => {
  const migrations = await readD1Migrations(here("./migrations"));
  // The maintainer's real signing key (gitignored) when it exists, so a test can also prove it matches
  // the public key published in docs/ARCHITECTURE.md. Elsewhere (CI, forks) an ephemeral Ed25519 key
  // is generated per run; the signature tests then verify against that key's public half, so they
  // keep checking the exact message format, tampering and kind binding either way.
  const keyFile = here("../secrets/signing-private-pkcs8.b64");
  // MWP_TEST_EPHEMERAL_KEY=1 forces the CI path locally.
  const realKey = existsSync(keyFile) && process.env.MWP_TEST_EPHEMERAL_KEY !== "1";
  const signingKey = realKey
    ? readFileSync(keyFile, "utf8").trim()
    : (generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "der" }) as Buffer).toString("base64");
  const spki = createPublicKey({ key: Buffer.from(signingKey, "base64"), format: "der", type: "pkcs8" }).export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyRaw = spki.subarray(spki.length - 32).toString("base64"); // raw 32-byte Ed25519 key
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SIGNING_KEY_PKCS8: signingKey,
            TEST_SIGNING_PUBLIC_KEY: publicKeyRaw,
            TEST_SIGNING_KEY_IS_REAL: realKey ? "1" : "",
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
