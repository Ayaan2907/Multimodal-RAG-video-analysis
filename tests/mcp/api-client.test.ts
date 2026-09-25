import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiClient,
  ApiClientError,
  createApiClient,
  readApiConfigFromEnv,
} from '@/mcp/api-client'

// The client is a transport: these tests pin the HTTP behavior the MCP tools
// depend on — Bearer auth, contract shapes, typed error mapping, and the
// no-silent-fallback rule (a failed request is never a degraded success).

const BASE = 'http://api.test'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/markdown' } })
}

function clientFrom(handler: (request: Request) => Promise<Response>): ApiClient {
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = input instanceof Request ? input : new Request(input.toString(), init)
    return handler(request)
  }) as unknown as typeof fetch
  return createApiClient({ baseUrl: BASE, apiKey: 'vidrag_sk_test', fetchImpl })
}

describe('readApiConfigFromEnv', () => {
  it('throws when VIDEO_RAG_API_URL is missing', () => {
    expect(() => readApiConfigFromEnv({ VIDEO_RAG_API_KEY: 'vidrag_sk_x' }))
      .toThrow(/VIDEO_RAG_API_URL/)
  })

  it('throws when VIDEO_RAG_API_KEY is missing', () => {
    expect(() => readApiConfigFromEnv({ VIDEO_RAG_API_URL: 'https://api.test' }))
      .toThrow(/VIDEO_RAG_API_KEY/)
  })

  it('returns the trimmed config when both are present', () => {
    expect(readApiConfigFromEnv({
      VIDEO_RAG_API_URL: ' https://api.test ',
      VIDEO_RAG_API_KEY: ' vidrag_sk_x ',
    })).toEqual({ baseUrl: 'https://api.test', apiKey: 'vidrag_sk_x' })
  })
})

describe('ApiClient auth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the org API key as a Bearer token on every request', async () => {
    let seenAuthorization: string | null = null
    const client = clientFrom(async request => {
      seenAuthorization = request.headers.get('authorization')
      return jsonResponse({ id: 'vid_1', status: 'completed', progress: 100 })
    })

    await client.getVideo('vid_1')
    expect(seenAuthorization).toBe('Bearer vidrag_sk_test')
  })
})

describe('ApiClient.ingestVideo', () => {
  it('posts the YouTube source envelope and returns the 202 contract', async () => {
    let seenBody: unknown
    const client = clientFrom(async request => {
      seenBody = await request.json()
      return jsonResponse({ id: 'vid_new', status: 'queued', status_url: '/api/v1/videos/vid_new/status' }, 202)
    })

    const accepted = await client.ingestVideo({ url: 'https://youtube.com/watch?v=x', title: 'T' })
    expect(accepted).toEqual({ id: 'vid_new', status: 'queued', status_url: '/api/v1/videos/vid_new/status' })
    expect(seenBody).toEqual({ source: { type: 'youtube', url: 'https://youtube.com/watch?v=x' }, title: 'T' })
  })

  it('forwards the Idempotency-Key header when provided', async () => {
    let seenHeader: string | null = null
    const client = clientFrom(async request => {
      seenHeader = request.headers.get('idempotency-key')
      return jsonResponse({ id: 'vid_new', status: 'queued', status_url: '/api/v1/videos/vid_new/status' }, 202)
    })

    await client.ingestVideo({ url: 'https://youtube.com/watch?v=x', idempotencyKey: 'retry-1' })
    expect(seenHeader).toBe('retry-1')
  })
})

describe('ApiClient.askVideo', () => {
  it('returns the answer+sources contract', async () => {
    const client = clientFrom(async () =>
      jsonResponse({
        answer: 'Signed on March third.',
        sources: [{
          chunk_id: 'chunk_1',
          video_id: 'vid_1',
          start_seconds: 0,
          end_seconds: 10.5,
          quote: 'The contract was signed on March third.',
          similarity: 0.9,
          title: null,
          matched_on: 'transcript',
        }],
      }),
    )

    const response = await client.askVideo('vid_1', 'When was it signed?')
    expect(response.answer).toBe('Signed on March third.')
    expect(response.sources[0]).toMatchObject({
      chunk_id: 'chunk_1',
      start_seconds: 0,
      end_seconds: 10.5,
      quote: 'The contract was signed on March third.',
    })
  })
})

describe('ApiClient error mapping', () => {
  it('maps the server error body {error:{code,message}} to a typed ApiClientError', async () => {
    const client = clientFrom(async () =>
      jsonResponse({ error: { code: 'video_not_found', message: 'Video not found' } }, 404),
    )

    await expect(client.getVideo('vid_missing')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 404,
      code: 'video_not_found',
    })
  })

  it('keeps the status on a non-JSON error body', async () => {
    const client = clientFrom(async () => new Response('<html>boom</html>', { status: 502 }))
    await expect(client.getVideo('vid_1')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 502,
      code: 'http_error',
    })
  })

  it('maps a network failure to a network_error ApiClientError', async () => {
    const client = createApiClient({
      baseUrl: BASE,
      apiKey: 'vidrag_sk_test',
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
    })

    await expect(client.getVideo('vid_1')).rejects.toMatchObject({
      name: 'ApiClientError',
      status: 0,
      code: 'network_error',
    })
  })
})

describe('ApiClient.getTranscript', () => {
  it('returns the raw body text for text formats', async () => {
    const client = clientFrom(async () => textResponse('# Transcript — Deposition\n'))
    const body = await client.getTranscript('vid_1', 'md')
    expect(body).toContain('# Transcript — Deposition')
  })

  it('surfaces a 404 as a typed error, not an empty string', async () => {
    const client = clientFrom(async () =>
      jsonResponse({ error: { code: 'video_not_found', message: 'Video not found' } }, 404),
    )
    await expect(client.getTranscript('vid_missing', 'md')).rejects.toBeInstanceOf(ApiClientError)
  })
})
