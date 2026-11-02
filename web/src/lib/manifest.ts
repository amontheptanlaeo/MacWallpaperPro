import { base64ToBytes, bytesToBase64 } from "./crypto";
import { HttpError } from "./http";

export interface SignedManifest {
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

async function signingKey(env: Env): Promise<CryptoKey> {
  const b64 = String(env.SIGNING_KEY_PKCS8 || "").trim();
  if (!b64) throw new HttpError(503, "signing_unavailable", "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าคีย์สำหรับเซ็น manifest");
  return crypto.subtle.importKey("pkcs8", base64ToBytes(b64), { name: "Ed25519" }, false, ["sign"]);
}

export async function signManifest(
  env: Env,
  m: { id: string; version: number; sha256: string; sizeBytes: number; title: string; author: string },
): Promise<SignedManifest> {
  const key = await signingKey(env);
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
