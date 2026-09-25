// Fixed-window in-process rate limiter, keyed by API key id.
// Single-process scope is fine for the revival deployment; a shared store can
// replace this without changing call sites when we run multiple instances.

interface Bucket {
  windowStart: number
  count: number
}

const WINDOW_MS = 60_000
const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function checkRateLimit(
  keyId: string,
  limitPerMinute: number,
  now: number = Date.now(),
): RateLimitResult {
  const bucket = buckets.get(keyId)

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(keyId, { windowStart: now, count: 1 })
    return { allowed: true, remaining: limitPerMinute - 1, retryAfterSeconds: 0 }
  }

  if (bucket.count >= limitPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000))
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  bucket.count += 1
  return { allowed: true, remaining: limitPerMinute - bucket.count, retryAfterSeconds: 0 }
}

// Test hook — clears all buckets between tests.
export function resetRateLimits(): void {
  buckets.clear()
}
