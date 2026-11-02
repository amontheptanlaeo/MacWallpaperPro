// WebCrypto helpers (no Math.random anywhere).

const enc = new TextEncoder();

export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function bytesToBase64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Url(buf: Uint8Array): string {
  return bytesToBase64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 chars, no look-alikes
/** Lowercase, filesystem-safe random id (the app uses it as a folder name). */
export function randomId(len = 14): string {
  const b = randomBytes(len);
  let s = "";
  for (const x of b) s += ID_ALPHABET[x & 31];
  return s;
}

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const input = typeof data === "string" ? enc.encode(data) : data;
  return bytesToHex(await crypto.subtle.digest("SHA-256", input));
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

/** PKCE S256 code challenge: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}
