import { HttpError } from "./http";

export interface Limit {
  limit: number;
  windowSec: number;
}

export const LIMITS = {
  oauth: { limit: 30, windowSec: 15 * 60 },
  devLogin: { limit: 30, windowSec: 15 * 60 },
  upload: { limit: 10, windowSec: 60 * 60 },
  videoPut: { limit: 20, windowSec: 60 * 60 },
} satisfies Record<string, Limit>;

/**
 * Fixed-window counter in D1. One atomic UPSERT per call; good enough for abuse throttling
 * (not a precise global limiter). Throws 429 when the window is exhausted.
 */
export async function rateLimit(env: Env, key: string, { limit, windowSec }: Limit): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = ?2 THEN rate_limits.count + 1 ELSE 1 END,
       window_start = ?2
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  if (row && row.count > limit) {
    const retry = windowStart + windowSec - now;
    throw new HttpError(429, "rate_limited", `Too many requests. Try again in ${Math.ceil(retry / 60)} min.`, {
      "Retry-After": String(retry),
    });
  }
}
