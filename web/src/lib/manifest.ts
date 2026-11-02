import { base64ToBytes, bytesToBase64 } from "./crypto";
import { HttpError } from "./http";

/**
 * v1 (HTML): exactly the original shape, byte-for-byte, so installed apps keep working.
 * v2 (video only): adds `format: 2` and `kind`, and the kind is covered by the signature.
 */
export interface SignedManifest {
  format?: 2;
  kind?: "video";
  id: string;
  version: number;
  sha256: string;
  sizeBytes: number;
  title: string;
  author: string;
  signature: string;
}

/** Exact signed message from docs/ARCHITECTURE.md: UTF-8, "\n"-joined, no trailing newline. */
export function manifestMessage(m: { id: string; version: number; sha256: string; sizeBytes: number }): string {
  return ["macwallpaperpro-manifest-v1", m.id, String(m.version), m.sha256.toLowerCase(), String(m.sizeBytes)].join("\n");
}

/** v2 signed message (video): the kind is signed so a manifest can't be replayed as another kind. */
export function manifestMessageV2(m: { id: string; version: number; kind: string; sha256: string; sizeBytes: number }): string {
  return ["macwallpaperpro-manifest-v2", m.id, String(m.version), m.kind, m.sha256.toLowerCase(), String(m.sizeBytes)].join("\n");
}

// The imported key is immutable and derived only from the secret, so caching it per isolate is safe
// and saves a PKCS#8 parse on every manifest request.
let cached: { b64: string; key: Promise<CryptoKey> } | null = null;

async function signingKey(env: Env): Promise<CryptoKey> {
  const b64 = String(env.SIGNING_KEY_PKCS8 || "").trim();
  if (!b64) throw new HttpError(503, "signing_unavailable", "The server has no manifest signing key configured.");
  if (!cached || cached.b64 !== b64) {
    const key = crypto.subtle.importKey("pkcs8", base64ToBytes(b64), { name: "Ed25519" }, false, ["sign"]);
    key.catch(() => (cached = null));
    cached = { b64, key };
  }
  return cached.key;
}

export async function signManifest(
  env: Env,
  m: { id: string; version: number; sha256: string; sizeBytes: number; title: string; author: string; kind?: "html" | "video" },
): Promise<SignedManifest> {
  const key = await signingKey(env);
  if (m.kind === "video") {
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(manifestMessageV2({ ...m, kind: "video" })));
    return {
      format: 2,
      kind: "video",
      id: m.id,
      version: m.version,
      sha256: m.sha256.toLowerCase(),
      sizeBytes: m.sizeBytes,
      title: m.title,
      author: m.author,
      signature: bytesToBase64(sig),
    };
  }
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(manifestMessage(m)));
  return {
    id: m.id,
    version: m.version,
    sha256: m.sha256.toLowerCase(),
    sizeBytes: m.sizeBytes,
    title: m.title,
    author: m.author,
    signature: bytesToBase64(sig),
  };
}
