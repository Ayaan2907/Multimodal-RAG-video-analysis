import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Webhook delivery (spec art_HKWx4t5y §4): signed video.completed POSTs with
// X-Vidrag-Signature over timestamp+body, initial attempt + 3 retries, and a
// best-effort attempt log that must never block or throw.

vi.mock('@/lib/supabase/admin', () => {
  type Result = { data: unknown; error: unknown }

  const state = {
    selectResult: { data: [], error: null } as Result,
    insertResult: { data: null, error: null } as Result,
    insertedRows: [] as Array<Record<string, unknown>>,
  }

  function chain() {
    const c: Record<string, unknown> = {}
    let didInsert = false
    const link = () => c
    c.select = link
    c.eq = link
    c.insert = (row: unknown) => {
      didInsert = true
      state.insertedRows.push(row as Record<string, unknown>)
      return c
    }
    c.maybeSingle = async () => state.insertResult
    c.single = async () => state.insertResult
    // Awaited directly for .select().eq() and .insert() queries — each chain
    // resolves to the result its last operation configured.
    c.then = (resolve: (v: { data: unknown; error: unknown }) => void) =>
      resolve(didInsert ? state.insertResult : state.selectResult)
    return c
  }

  const adminClient = { from: () => chain() }

  return {
    getSupabaseAdmin: () => adminClient,
    supabaseAdmin: adminClient,
    __state: state,
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = (await import('@/lib/supabase/admin')) as any
const state = supabase.__state as {
  selectResult: { data: unknown; error: unknown }
  insertResult: { data: unknown; error: unknown }
  insertedRows: Array<Record<string, unknown>>
}

import {
  buildVideoCompletedPayload,
  deliverWebhook,
  dispatchVideoCompleted,
} from '@/lib/webhooks/dispatch'
import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_DELIVERY_HEADER,
} from '@/lib/webhooks/signature'

const ENDPOINT = {
  id: 'ep-1',
  organization_id: 'org-1',
  url: 'https://receiver.example/hook',
  // Runtime-assembled (see signature.test.ts) to avoid the secret scanner's
  // literal-assignment rule — this is a fake receiver fixture.
  secret: 'whsec_' + 'receiver_secret',
  events: ['video.completed'],
}

const PAYLOAD_DATA = {
  video_id: 'vid-1',
  title: 'Deposition',
  status: 'completed' as const,
  content_sha256: 'a'.repeat(64),
  status_url: '/api/v1/videos/vid-1/status',
}

function mockFetch(status: number | 'throw'): { calls: Array<{ url: string; init: RequestInit }>; impl: typeof fetch } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit })
    if (status === 'throw') throw new Error('connection refused')
    return new Response('{}', { status })
  }) as unknown as typeof fetch
  return { calls, impl }
}

beforeEach(() => {
  state.selectResult = { data: [ENDPOINT], error: null }
  state.insertResult = { data: null, error: null }
  state.insertedRows = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('deliverWebhook', () => {
  it('sends a request verifiable with the endpoint secret over timestamp+body', async () => {
    const { calls, impl } = mockFetch(200)
    const result = await deliverWebhook({
      endpoint: ENDPOINT,
      eventType: 'video.completed',
      payload: buildVideoCompletedPayload(PAYLOAD_DATA),
      deps: { fetchImpl: impl, sleepImpl: async () => {} },
    })

    expect(result.delivered).toBe(true)
    expect(result.attempts).toBe(1)
    expect(calls).toHaveLength(1)

    const headers = new Headers(calls[0]!.init.headers as Record<string, string>)
    const timestamp = headers.get(WEBHOOK_TIMESTAMP_HEADER)!
    const signature = headers.get(WEBHOOK_SIGNATURE_HEADER)!
    const rawBody = calls[0]!.init.body as string

    // A receiver recomputing HMAC-SHA256(secret, `${t}.${rawBody}`) must verify.
    const verification = verifyWebhookSignature({
      secret: ENDPOINT.secret,
      rawBody,
      timestampHeader: timestamp,
      signatureHeader: signature,
      nowSeconds: Number.parseInt(timestamp, 10),
    })
    expect(verification).toEqual({ ok: true })

    // The envelope is the documented event contract.
    expect(headers.get(WEBHOOK_EVENT_HEADER)).toBe('video.completed')
    expect(headers.get(WEBHOOK_DELIVERY_HEADER)).toBeTruthy()
    const envelope = JSON.parse(rawBody)
    expect(envelope.type).toBe('video.completed')
    expect(envelope.data).toEqual(PAYLOAD_DATA)
  })

  it('retries to exhaustion: initial + 3 retries = 4 attempts on persistent failure', async () => {
    const { calls, impl } = mockFetch(500)
    const result = await deliverWebhook({
      endpoint: ENDPOINT,
      eventType: 'video.completed',
      payload: buildVideoCompletedPayload(PAYLOAD_DATA),
      deps: { fetchImpl: impl, sleepImpl: async () => {} },
    })

    expect(result.delivered).toBe(false)
    expect(result.attempts).toBe(4)
    expect(calls).toHaveLength(4)
    expect(result.lastStatusCode).toBe(500)
    expect(result.lastError).toBe('HTTP 500')
  })

  it('stops retrying after the first success', async () => {
    const { calls, impl } = mockFetch(200)
    const result = await deliverWebhook({
      endpoint: ENDPOINT,
      eventType: 'video.completed',
      payload: buildVideoCompletedPayload(PAYLOAD_DATA),
      deps: { fetchImpl: impl, sleepImpl: async () => {} },
    })
    expect(result.attempts).toBe(1)
    expect(calls).toHaveLength(1)
  })

  it('records every attempt in webhook_deliveries', async () => {
    const { impl } = mockFetch(500)
    await deliverWebhook({
      endpoint: ENDPOINT,
      eventType: 'video.completed',
      payload: buildVideoCompletedPayload(PAYLOAD_DATA),
      deps: { fetchImpl: impl, sleepImpl: async () => {} },
    })
    expect(state.insertedRows).toHaveLength(4)
    expect(state.insertedRows[0]).toMatchObject({
      endpoint_id: ENDPOINT.id,
      event_type: 'video.completed',
      attempt: 1,
      ok: false,
      status_code: 500,
    })
  })

  it('does not fail delivery when the attempt log insert fails', async () => {
    state.insertResult = { data: null, error: { message: 'insert failed' } }
    const { impl } = mockFetch(200)
    const result = await deliverWebhook({
      endpoint: ENDPOINT,
      eventType: 'video.completed',
      payload: buildVideoCompletedPayload(PAYLOAD_DATA),
      deps: { fetchImpl: impl, sleepImpl: async () => {} },
    })
    expect(result.delivered).toBe(true)
  })
})

describe('dispatchVideoCompleted', () => {
  it('delivers only to endpoints subscribed to video.completed', async () => {
    const { calls, impl } = mockFetch(200)
    state.selectResult = {
      data: [ENDPOINT, { ...ENDPOINT, id: 'ep-2', events: ['video.deleted'] }, { ...ENDPOINT, id: 'ep-3' }],
      error: null,
    }

    const results = await dispatchVideoCompleted('org-1', PAYLOAD_DATA, { fetchImpl: impl, sleepImpl: async () => {} })

    expect(results).toHaveLength(2)
    expect(results.every(r => r.delivered)).toBe(true)
    // ep-2 (video.deleted only) filters out; ep-1 and ep-3 (subscribed) receive.
    expect(calls).toHaveLength(2)
  })

  it('delivers nothing when the org has no endpoints', async () => {
    const { calls, impl } = mockFetch(200)
    state.selectResult = { data: [], error: null }
    const results = await dispatchVideoCompleted('org-1', PAYLOAD_DATA, { fetchImpl: impl, sleepImpl: async () => {} })
    expect(results).toEqual([])
    expect(calls).toEqual([])
  })

  it('returns no deliveries when the endpoint lookup fails (fail-closed, no throw)', async () => {
    const { impl } = mockFetch(200)
    state.selectResult = { data: null, error: { message: 'db down' } }
    const results = await dispatchVideoCompleted('org-1', PAYLOAD_DATA, { fetchImpl: impl, sleepImpl: async () => {} })
    expect(results).toEqual([])
  })

  it('one endpoint rejecting does not affect the others', async () => {
    const calls: Array<{ url: string }> = []
    const impl = (async (url: unknown) => {
      calls.push({ url: String(url) })
      if (String(url).includes('bad')) throw new Error('connection refused')
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    state.selectResult = {
      data: [ENDPOINT, { ...ENDPOINT, id: 'ep-bad', url: 'https://bad.example/hook' }],
      error: null,
    }

    const results = await dispatchVideoCompleted('org-1', PAYLOAD_DATA, { fetchImpl: impl, sleepImpl: async () => {} })
    expect(results[0]).toMatchObject({ delivered: true, attempts: 1 })
    expect(results[1]).toMatchObject({ delivered: false, attempts: 4 })
  })
})
