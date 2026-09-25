import { beforeEach, describe, expect, it } from 'vitest'
import { checkRateLimit, resetRateLimits } from '@/lib/auth/rate-limit'

const WINDOW_MS = 60_000

describe('checkRateLimit', () => {
  beforeEach(() => resetRateLimits())

  it('allows the first request and reports remaining quota', () => {
    const result = checkRateLimit('key-1', 5, 1_000_000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests beyond the per-minute limit with a retry-after', () => {
    const start = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('key-2', 5, start).allowed).toBe(true)
    }
    const blocked = checkRateLimit('key-2', 5, start + 1_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('resets after the window elapses', () => {
    const start = 2_000_000
    for (let i = 0; i < 5; i++) checkRateLimit('key-3', 5, start)
    expect(checkRateLimit('key-3', 5, start + 1_000).allowed).toBe(false)
    const refreshed = checkRateLimit('key-4', 5, start + WINDOW_MS)
    // New window opens for the same key after 60s.
    const sameKeyAfterWindow = checkRateLimit('key-3', 5, start + WINDOW_MS)
    expect(sameKeyAfterWindow.allowed).toBe(true)
    void refreshed
  })

  it('tracks keys independently', () => {
    const start = 3_000_000
    for (let i = 0; i < 5; i++) checkRateLimit('key-a', 5, start)
    expect(checkRateLimit('key-a', 5, start + 1).allowed).toBe(false)
    expect(checkRateLimit('key-b', 5, start + 1).allowed).toBe(true)
  })
})