declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

declare namespace Cloudflare {
  // Test-only bindings from vitest.config.ts.
  interface Env {
    /** Raw Ed25519 public key (base64) of the key the tests sign with. */
    TEST_SIGNING_PUBLIC_KEY: string;
    /** "1" when that is the maintainer's real key (secrets/), "" for an ephemeral CI key. */
    TEST_SIGNING_KEY_IS_REAL: string;
  }
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
