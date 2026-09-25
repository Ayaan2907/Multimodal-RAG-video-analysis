import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/v1/videos/{id}/status contract (spec art_HKWx4t5y §4): org-scoped,
// status is the migration enum, failed carries the error, unknown statuses are
// a typed 500 — never a fabricated status.

vi.mock('@/lib/supabase/database', () => ({
  getVideoById: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => {
  const state = { maybeSingleQueue: [] as Array<{ data: unknown; error: unknown }> }
  function chain() {
    const c: Record<string, unknown> = {}
    const link = () => c
    c.select = link
    c.eq = link
    c.update = link
    c.maybeSingle = async () => state.maybeSingleQueue.shift() ?? { data: null, error: null }
    c.then = (resolve: (v: { data: unknown; error: unknown }) => void) => resolve({ data: null, error: null })
    return c
  }
  const adminClient = { from: () => chain() }
  return { getSupabaseAdmin: () => adminClient, supabaseAdmin: adminClient, __state: state }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = (await import('@/lib/supabase/admin')) as any
const authState = supabase.__state as { maybeSingleQueue: Array<{ data: unknown; error: unknown }> }

const { getVideoById } = (await import('@/lib/supabase/database')) as unknown as {
  getVideoById: ReturnType<typeof vi.fn>
}
const getVideoByIdMock = vi.mocked(getVideoById)

import { GET as statusGET } from '@/app/api/v1/videos/[id]/status/route'
import { generateApiKey } from '@/lib/auth/api-keys'

const API_KEY = generateApiKey().key

function get(): Request {
  return new Request('http://localhost/api/v1/videos/vid-1/status', {
    headers: { authorization: `Bearer ${API_KEY}` },
  })
}

const params = { params: Promise.resolve({ id: 'vid-1' }) }

const BASE_VIDEO = {
  id: 'vid-1',
  title: 'Deposition',
  source_type: 'youtube',
  processing_status: 'completed',
  processing_error: null,
  duration_seconds: 120,
}

beforeEach(() => {
  getVideoByIdMock.mockReset()
  getVideoByIdMock.mockResolvedValue(BASE_VIDEO)
  authState.maybeSingleQueue = [
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
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v1/videos/[id]/status', () => {
  it.each([
    ['uploading', 10],
    ['processing', 25],
    ['chunking', 50],
    ['transcribing', 60],
    ['embedding', 80],
    ['completed', 100],
  ])('reports %s with progress %i', async (status, progress) => {
    getVideoByIdMock.mockResolvedValue({ ...BASE_VIDEO, processing_status: status })
    const res = await statusGET(get() as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ id: 'vid-1', status, progress })
  })

  it('carries the pipeline error on failed', async () => {
    getVideoByIdMock.mockResolvedValue({
      ...BASE_VIDEO,
      processing_status: 'failed',
      processing_error: 'transcription unavailable',
    })
    const res = await statusGET(get() as never, params)
    const body = await res.json()
    expect(body.status).toBe('failed')
    expect(body.error).toBe('transcription unavailable')
    expect(body.progress).toBe(0)
  })

  it('answers 404 with the error envelope for a foreign or unknown video', async () => {
    getVideoByIdMock.mockResolvedValue(null)
    const res = await statusGET(get() as never, params)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('video_not_found')
  })

  it('answers a typed 500 when the stored status is outside the contract', async () => {
    getVideoByIdMock.mockResolvedValue({ ...BASE_VIDEO, processing_status: 'weird' })
    const res = await statusGET(get() as never, params)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('status_contract_violation')
  })
})
