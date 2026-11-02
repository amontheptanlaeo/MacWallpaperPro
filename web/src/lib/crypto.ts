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

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// ---------------------------------------------------------------------------
// Passwords: PBKDF2-HMAC-SHA256, random 16-byte salt, 210,000 total iterations.
//
// The Workers runtime caps a single PBKDF2 deriveBits call at 100,000 iterations.
// To keep the contract's >= 210,000 work factor we chain 3 rounds of 70,000:
//   k1 = PBKDF2(password, salt, 70000); k2 = PBKDF2(k1, salt, 70000); k3 = PBKDF2(k2, salt, 70000)
// Each round needs the previous output, so an attacker still pays 210,000 sequential HMACs.
// Format: pbkdf2-sha256$<rounds>x<iterations>$<salt b64>$<hash b64>
// ---------------------------------------------------------------------------
export const PBKDF2_ROUNDS = 3;
export const PBKDF2_ITERATIONS_PER_ROUND = 70_000;

async function pbkdf2(input: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", input, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function deriveChained(password: string, salt: Uint8Array, rounds: number, iterations: number) {
  let k: Uint8Array = enc.encode(password.normalize("NFKC"));
  for (let i = 0; i < rounds; i++) k = await pbkdf2(k, salt, iterations);
  return k;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveChained(password, salt, PBKDF2_ROUNDS, PBKDF2_ITERATIONS_PER_ROUND);
  return `pbkdf2-sha256$${PBKDF2_ROUNDS}x${PBKDF2_ITERATIONS_PER_ROUND}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^pbkdf2-sha256\$(\d+)x(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const rounds = Number(m[1]);
  const iterations = Number(m[2]);
  if (rounds < 1 || rounds > 10 || iterations < 1 || iterations > 100_000) return false;
  const hash = await deriveChained(password, base64ToBytes(m[3]), rounds, iterations);
  const expected = base64ToBytes(m[4]);
  if (expected.byteLength !== hash.byteLength) return false;
  return crypto.subtle.timingSafeEqual(hash, expected);
}

/** Dummy verify to equalize timing when the account does not exist. */
export const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256$3x70000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
