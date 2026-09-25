import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/v1/ingest contract (spec art_HKWx4t5y §4): async-first 202 with
// {id, status:'queued', status_url}; a duplicate Idempotency-Key replays the
// first video id instead of creating a second ingest; validation failures use
// the shared error envelope.

vi.mock('@/lib/supabase/admin', () => {
  type Result = { data: unknown; error: unknown }

  const state = {
    maybeSingleQueue: [] as Array<{ data: unknown; error: unknown }>,
    insertSingleResult: { data: { id: 'idem-1' }, error: null } as { data: unknown; error: unknown },
    insertedRows: [] as Array<Record<string, unknown>>,
  }

  function chain() {
    const c: Record<string, unknown> = {}
    let didInsert = false
    const link = () => c
    c.select = link
    c.eq = link
    c.limit = link
    c.update = link
    c.insert = (row: unknown) => {
      didInsert = true
      state.insertedRows.push(row as Record<string, unknown>)
      return c
    }
    c.maybeSingle = async () => state.maybeSingleQueue.shift() ?? { data: null, error: null }
    c.single = async () => state.insertSingleResult
    c.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve(didInsert ? state.insertSingleResult : { data: null, error: null })
    return c
  }

  const adminClient = { from: () => chain() }
  return {
    getSupabaseAdmin: () => adminClient,
    supabaseAdmin: adminClient,
    __state: state,
  }
})

vi.mock('@/lib/ingest/async', () => ({
  createYoutubeIngest: vi.fn(),
  createUploadIngest: vi.fn(),
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = (await import('@/lib/supabase/admin')) as any
const state = supabase.__state as {
  maybeSingleQueue: Array<{ data: unknown; error: unknown }>
  insertSingleResult: { data: unknown; error: unknown }
  insertedRows: Array<Record<string, unknown>>
}
const { createYoutubeIngest } = (await import('@/lib/ingest/async')) as unknown as {
  createYoutubeIngest: ReturnType<typeof vi.fn>
}
const createYoutubeIngestMock = vi.mocked(createYoutubeIngest)

import { POST as ingestPOST } from '@/app/api/v1/ingest/route'
import { generateApiKey } from '@/lib/auth/api-keys'

const API_KEY = generateApiKey().key

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/ingest', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
      ...headers,
    },
  })
}

const YOUTUBE_BODY = JSON.stringify({ source: { type: 'youtube', url: 'https://youtube.com/watch?v=abc' } })

// Call-order queue for maybeSingle: [auth key lookup, idempotency lookup].
const KEY_ROW = {
  data: {
    id: 'key-1',
    organization_id: 'org-1',
    scopes: ['ingest:write', 'library:read', 'chat:run'],
    rate_limit_per_minute: 60,
    revoked_at: null,
  },
  error: null,
}

beforeEach(() => {
  state.maybeSingleQueue = [KEY_ROW, { data: null, error: null }]
  state.insertSingleResult = { data: { id: 'idem-1' }, error: null }
  state.insertedRows = []
  createYoutubeIngestMock.mockReset()
  createYoutubeIngestMock.mockResolvedValue({ ok: true, videoId: 'vid-new' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/ingest', () => {
  it('answers 202 queued with a status_url, asynchronously', async () => {
    const res = await ingestPOST(post(YOUTUBE_BODY) as never)
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual({
      id: 'vid-new',
      status: 'queued',
      status_url: '/api/v1/videos/vid-new/status',
    })
  })

  it('replays the same video id for a repeated Idempotency-Key without re-ingesting', async () => {
    const first = await ingestPOST(post(YOUTUBE_BODY, { 'Idempotency-Key': 'job-42' }) as never)
    expect(first.status).toBe(202)
    expect(await first.json()).toMatchObject({ id: 'vid-new' })

    // The lookup now sees the recorded key → the replay returns the same id
    // and must not call the ingest pipeline again.
    state.maybeSingleQueue = [KEY_ROW, { data: { video_id: 'vid-first' }, error: null }]
    const second = await ingestPOST(post(YOUTUBE_BODY, { 'Idempotency-Key': 'job-42' }) as never)
    expect(second.status).toBe(202)
    expect(await second.json()).toMatchObject({ id: 'vid-first' })
    expect(createYoutubeIngestMock).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed JSON with a 400 error envelope', async () => {
    const res = await ingestPOST(post('not json') as never)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
    expect(typeof body.error.message).toBe('string')
  })

  it('rejects a missing or wrong-type source', async () => {
    state.maybeSingleQueue = [KEY_ROW]
    const noSource = await ingestPOST(post(JSON.stringify({})) as never)
    expect(noSource.status).toBe(400)
    expect((await noSource.json()).error.code).toBe('invalid_source')

    state.maybeSingleQueue = [KEY_ROW]
    const uploadOverJson = await ingestPOST(
      post(JSON.stringify({ source: { type: 'upload' } })) as never,
    )
    expect(uploadOverJson.status).toBe(400)
    expect((await uploadOverJson.json()).error.code).toBe('invalid_source')
  })

  it('rejects a YouTube source without a URL', async () => {
    const res = await ingestPOST(post(JSON.stringify({ source: { type: 'youtube' } })) as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('missing_url')
  })

  it('maps pipeline validation failures to 400 and environment failures to 500', async () => {
    createYoutubeIngestMock.mockResolvedValue({
      ok: false,
      validation: { code: 'invalid_youtube_url', message: 'Not a YouTube URL' },
    })
    const bad = await ingestPOST(post(YOUTUBE_BODY) as never)
    expect(bad.status).toBe(400)
    expect((await bad.json()).error.code).toBe('invalid_youtube_url')

    createYoutubeIngestMock.mockResolvedValue({
      ok: false,
      validation: { code: 'database_error', message: 'Insert failed' },
    })
    state.maybeSingleQueue = [KEY_ROW]
    const envFailure = await ingestPOST(post(YOUTUBE_BODY) as never)
    expect(envFailure.status).toBe(500)
  })

  it('records the idempotency key scoped to (organization_id, key)', async () => {
    await ingestPOST(post(YOUTUBE_BODY, { 'Idempotency-Key': '  Job 42  ' }) as never)
    expect(state.insertedRows).toHaveLength(1)
    expect(state.insertedRows[0]).toMatchObject({
      organization_id: 'org-1',
      // Keys are trimmed but case-preserved — opaque client strings compared
      // verbatim on replay.
      idempotency_key: 'Job 42',
      video_id: 'vid-new',
    })
  })
})
