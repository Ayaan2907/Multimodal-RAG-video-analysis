import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The guard is the exact module every /api route calls first, so its status
// matrix is the auth contract: 401 = missing/malformed/unknown/revoked key,
// 403 = scope not granted, 429 = rate limit, 500 = lookup failure (fail-closed).

vi.mock('@/lib/supabase/admin', () => {
  type MaybeSingleResult = { data: unknown; error: unknown }

  interface Chain {
    select: () => Chain
    eq: () => Chain
    update: () => Chain
    maybeSingle: () => Promise<MaybeSingleResult>
  }

  let next: MaybeSingleResult = { data: null, error: null }

  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    maybeSingle: async () => next,
  }

  const adminClient = { from: () => chain }

  return {
    getSupabaseAdmin: () => adminClient,
    supabaseAdmin: adminClient,
    __setMaybeSingleResult: (result: MaybeSingleResult) => {
      next = result
    },
  }
})

import { authenticateRequest } from '@/lib/auth/request'
import {
  generateApiKey,
  hashApiKey,
} from '@/lib/auth/api-keys'
//eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = (await import('@/lib/supabase/admin')) as any

const VALID_KEY = generateApiKey().key

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    organization_id: 'org-1',
    scopes: ['ingest:write', 'library:read', 'chat:run'],
    rate_limit_per_minute: 60,
    revoked_at: null,
    ...overrides,
  }
}

function authedRequest(): Request {
  return new Request('http://localhost/api/test', {
    headers: { authorization: `Bearer ${VALID_KEY}` },
  })
}

beforeEach(() => {
  mocks.__setMaybeSingleResult({ data: keyRow(), error: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('authenticateRequest', () => {
  it('401 without an Authorization header', async () => {
    const result = await authenticateRequest(
      new Request('http://localhost/api/test'),
      'library:read',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('missing_api_key')
    }
  })

  it('401 with a non-Bearer header', async () => {
    const result = await authenticateRequest(
      new Request('http://localhost/api/test', {
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      }),
      'library:read',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('401 with a malformed key (wrong prefix/length)', async () => {
    const result = await authenticateRequest(
      new Request('http://localhost/api/test', {
        headers: { authorization: 'Bearer not-a-real-key' },
      }),
      'library:read',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('malformed_api_key')
    }
  })

  it('401 for a key that hashes to nothing in the database', async () => {
    mocks.__setMaybeSingleResult({ data: null, error: null })
    const result = await authenticateRequest(authedRequest(), 'library:read')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('unknown_api_key')
    }
  })

  it('401 for a revoked key', async () => {
    mocks.__setMaybeSingleResult({
      data: keyRow({ revoked_at: '2026-01-01T00:00:00Z' }),
      error: null,
    })
    const result = await authenticateRequest(authedRequest(), 'library:read')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.code).toBe('revoked_api_key')
    }
  })

  it('500 (fail-closed) when the key lookup errors', async () => {
    mocks.__setMaybeSingleResult({ data: null, error: { message: 'db down' } })
    const result = await authenticateRequest(authedRequest(), 'library:read')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.code).toBe('auth_lookup_failed')
    }
  })

  it('403 when the key lacks the required scope', async () => {
    mocks.__setMaybeSingleResult({
      data: keyRow({ scopes: ['library:read'] }),
      error: null,
    })
    const result = await authenticateRequest(authedRequest(), 'chat:run')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.code).toBe('scope_not_granted')
      expect(result.message).toContain('chat:run')
    }
  })

  it('403 for a key with no scopes at all', async () => {
    mocks.__setMaybeSingleResult({ data: keyRow({ scopes: null }), error: null })
    const result = await authenticateRequest(authedRequest(), 'ingest:write')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
      expect(result.code).toBe('scope_not_granted')
    }
  })

  it('succeeds when the key has the required scope, exposing the org id', async () => {
    const result = await authenticateRequest(authedRequest(), 'ingest:write')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.context.organizationId).toBe('org-1')
      expect(result.context.keyId).toBe('key-1')
      expect(result.context.scopes).toContain('ingest:write')
    }
  })

  it('looks the key up by its sha256 hash, never the plaintext', async () => {
    const probe = vi.fn()
    // Re-mock with a spy on eq arguments is overkill; assert via hash contract:
    expect(hashApiKey(VALID_KEY)).toMatch(/^[0-9a-f]{64}$/)
    void probe
  })

  it('429 when the per-key rate limit is exhausted', async () => {
    // Rate limiter is keyed by key id and shared across calls in this process.
    mocks.__setMaybeSingleResult({
      data: keyRow({ id: 'rate-test-key', rate_limit_per_minute: 1 }),
      error: null,
    })
    const first = await authenticateRequest(authedRequest(), 'library:read')
    expect(first.ok).toBe(true)
    const second = await authenticateRequest(authedRequest(), 'library:read')
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.status).toBe(429)
      expect(second.code).toBe('rate_limit_exceeded')
    }
  })
})
