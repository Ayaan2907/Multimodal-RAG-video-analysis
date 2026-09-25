import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/v1/search contract (spec art_HKWx4t5y §4): ranked chunk retrieval
// across the org's library — over ≥2 fixture videos — with min_similarity
// enforced server-side (default 0.5) and org scoping done by the RPC itself.

vi.mock('@/lib/supabase/admin', () => {
  const state = {
    maybeSingleQueue: [] as Array<{ data: unknown; error: unknown }>,
    rpcName: '' as string,
    rpcArgs: {} as Record<string, unknown>,
    rpcResult: { data: [], error: null } as { data: unknown; error: unknown },
  }

  function chain() {
    const c: Record<string, unknown> = {}
    const link = () => c
    c.select = link
    c.eq = link
    c.in = link
    c.returns = link
    c.update = link
    // Auth lookups fall back to a valid key row when the queue is empty —
    // every test here authenticates, and loop tests make many requests.
    c.maybeSingle = async () => state.maybeSingleQueue.shift() ?? {
      data: {
        id: 'key-1',
        organization_id: 'org-1',
        scopes: ['ingest:write', 'library:read', 'chat:run'],
        rate_limit_per_minute: 60,
        revoked_at: null,
      },
      error: null,
    }
    c.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data: null, error: null })
    return c
  }

  const adminClient = {
    from: () => chain(),
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcName = name
      state.rpcArgs = args
      return {
        then: (resolve: (v: { data: unknown; error: unknown }) => void) => resolve(state.rpcResult),
      }
    },
  }

  return {
    getSupabaseAdmin: () => adminClient,
    supabaseAdmin: adminClient,
    __state: state,
  }
})

vi.mock('@/lib/ai/embeddings', () => ({
  generateTextEmbedding: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = (await import('@/lib/supabase/admin')) as any
const rpcState = supabase.__state as {
  maybeSingleQueue: Array<{ data: unknown; error: unknown }>
  rpcName: string
  rpcArgs: Record<string, unknown>
  rpcResult: { data: unknown; error: unknown }
}
const { generateTextEmbedding } = (await import('@/lib/ai/embeddings')) as unknown as {
  generateTextEmbedding: ReturnType<typeof vi.fn>
}
const generateTextEmbeddingMock = vi.mocked(generateTextEmbedding)

import { POST as searchPOST } from '@/app/api/v1/search/route'
import { generateApiKey } from '@/lib/auth/api-keys'

const API_KEY = generateApiKey().key

function post(body: unknown): Parameters<typeof searchPOST>[0] {
  return new Request('http://localhost/api/v1/search', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
    },
  }) as unknown as Parameters<typeof searchPOST>[0]
}

// Two fixture videos, both in org-1 — the cross-video retrieval requirement.
const MATCHES = [
  {
    id: 'emb-1',
    video_id: 'vid-a',
    chunk_id: 'chunk-a1',
    content_type: 'transcript',
    content_text: 'The contract was signed on March third.',
    similarity: 0.91,
  },
  {
    id: 'emb-2',
    video_id: 'vid-b',
    chunk_id: 'chunk-b1',
    content_type: 'transcript',
    content_text: 'The witness identified the signature.',
    similarity: 0.77,
  },
]

beforeEach(() => {
  generateTextEmbeddingMock.mockReset()
  generateTextEmbeddingMock.mockResolvedValue({ embedding: [0.1, 0.2], error: null })
  rpcState.maybeSingleQueue = [
    {
      data: {
        id: 'key-1',
        organization_id: 'org-1',
        scopes: ['ingest:write', 'library:read', 'chat:run'],
        rate_limit_per_minute: 60,
        revoked_at: null,
      },
      error: null,
    },
  ]
  rpcState.rpcName = ''
  rpcState.rpcArgs = {}
  rpcState.rpcResult = { data: MATCHES, error: null }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/search', () => {
  it('ranks results across ≥2 videos by descending similarity', async () => {
    const res = await searchPOST(post({ query: 'contract signing' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.query).toBe('contract signing')
    expect(body.results).toHaveLength(2)
    expect(body.results.map((r: { video_id: string }) => r.video_id)).toEqual(['vid-a', 'vid-b'])
    expect(body.results[0].similarity).toBeGreaterThan(body.results[1].similarity)
    // Every result carries the evidence fields a client needs to cite it.
    for (const result of body.results) {
      expect(result).toHaveProperty('chunk_id')
      expect(result).toHaveProperty('video_id')
      expect(result).toHaveProperty('content_text')
      expect(result).toHaveProperty('similarity')
    }
  })

  it('enforces the default min_similarity of 0.5 in the RPC call', async () => {
    await searchPOST(post({ query: 'contract signing' }))
    expect(rpcState.rpcName).toBe('match_embeddings_org')
    expect(rpcState.rpcArgs.match_threshold).toBe(0.5)
  })

  it('passes a custom min_similarity through to the RPC', async () => {
    await searchPOST(post({ query: 'contract signing', min_similarity: 0.65 }))
    expect(rpcState.rpcArgs.match_threshold).toBe(0.65)
  })

  it('scopes the RPC to the caller organization', async () => {
    await searchPOST(post({ query: 'contract signing' }))
    expect(rpcState.rpcArgs.p_organization_id).toBe('org-1')
  })

  it('passes the video_ids filter through when provided', async () => {
    await searchPOST(post({ query: 'contract signing', video_ids: ['vid-a'] }))
    expect(rpcState.rpcArgs.p_video_ids).toEqual(['vid-a'])
  })

  it('clamps top_k validation: integers within 1..50 only', async () => {
    for (const bad of [0, -1, 51, 1.5, '5']) {
      const res = await searchPOST(post({ query: 'q', top_k: bad }))
      expect(res.status).toBe(400)
      expect((await res.json()).error.code).toBe('invalid_request')
    }
    const ok = await searchPOST(post({ query: 'q', top_k: 50 }))
    expect(ok.status).toBe(200)
    expect(rpcState.rpcArgs.match_count).toBe(50)
  })

  it('rejects out-of-range min_similarity before calling the pipeline', async () => {
    for (const bad of [0, 1, 1.5, -0.5]) {
      const res = await searchPOST(post({ query: 'q', min_similarity: bad }))
      expect(res.status).toBe(400)
    }
    expect(generateTextEmbeddingMock).not.toHaveBeenCalled()
  })

  it('rejects an empty query', async () => {
    const res = await searchPOST(post({ query: '   ' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_request')
  })

  it('answers a typed 500 when query embedding fails (no silent fallback)', async () => {
    generateTextEmbeddingMock.mockResolvedValue({ embedding: null, error: 'provider down' })
    const res = await searchPOST(post({ query: 'contract signing' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('query_embedding_failed')
  })

  it('answers a typed 500 when the retrieval RPC fails', async () => {
    rpcState.rpcResult = { data: null, error: { message: 'rpc failed' } }
    const res = await searchPOST(post({ query: 'contract signing' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('retrieval_failed')
  })

  it('returns an empty results array when nothing matches (not an error)', async () => {
    rpcState.rpcResult = { data: [], error: null }
    const res = await searchPOST(post({ query: 'contract signing' }))
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
  })
})
