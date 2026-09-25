#!/usr/bin/env node
// Fixture implementation of the API v1 surface (spec art_HKWx4t5y §4) for
// MCP smoke tests — canned evidence, same contracts as the real server,
// zero external services. It fakes the API; it does not reimplement any
// pipeline logic.
//
// Direct run:
//   bun mcp/fixtures/server.mjs --port 8977
// Then point the MCP server at it and exercise it with the inspector:
//   VIDEO_RAG_API_URL=http://127.0.0.1:8977 VIDEO_RAG_API_KEY=vidrag_sk_fixture \
//     npx -y @modelcontextprotocol/inspector --cli bun mcp/server.ts --method tools/call ...
//
// The fixture key prefix matches the real one; any vidrag_sk_… value is
// accepted so the auth header still flows end to end.

import { createServer } from 'node:http'

export const FIXTURE_API_KEY_PREFIX = 'vidrag_sk_'
export const FIXTURE_VIDEO_ID = 'vid_fixture_001'
export const FIXTURE_INGESTED_VIDEO_ID = 'vid_fixture_002'

export const FIXTURE_VIDEO = {
  id: FIXTURE_VIDEO_ID,
  title: 'Deposition — Day 1',
  source_type: 'youtube',
  source_url: 'https://youtube.com/watch?v=fixture',
  duration_seconds: 20,
}

export const FIXTURE_CHUNKS = [
  {
    id: 'chunk_fixture_001',
    video_id: FIXTURE_VIDEO_ID,
    title: 'Opening',
    start_time_seconds: 0,
    end_time_seconds: 10.5,
    transcript_text: 'The contract was signed on March third.',
  },
  {
    id: 'chunk_fixture_002',
    video_id: FIXTURE_VIDEO_ID,
    title: 'Testimony',
    start_time_seconds: 10.5,
    end_time_seconds: 20,
    transcript_text: 'The witness identified the signature.',
  },
]

/** Same verbatim-quote evidence contract as lib/evidence/chat-sources.ts. */
export const FIXTURE_CHAT_SOURCES = [
  {
    chunk_id: 'chunk_fixture_001',
    video_id: FIXTURE_VIDEO_ID,
    start_seconds: 0,
    end_seconds: 10.5,
    quote: 'The contract was signed on March third.',
    similarity: 0.91,
    title: 'Opening',
    matched_on: 'transcript',
  },
]

export const FIXTURE_CHAT_RESPONSE = {
  answer: 'The witness stated the contract was signed on March third (from 0s to 10.5s).',
  sources: FIXTURE_CHAT_SOURCES,
}

export const FIXTURE_SEARCH_RESPONSE = {
  query: 'contract signing',
  results: [
    {
      video_id: FIXTURE_VIDEO_ID,
      chunk_id: 'chunk_fixture_001',
      title: 'Opening',
      content_type: 'transcript',
      content_text: 'The contract was signed on March third.',
      start_seconds: 0,
      end_seconds: 10.5,
      similarity: 0.89,
    },
  ],
}

/** Mirrors the structured transcript export (lib/export/transcript.ts renderJson). */
export const FIXTURE_TRANSCRIPT_JSON = {
  video_id: FIXTURE_VIDEO_ID,
  title: FIXTURE_VIDEO.title,
  exported_at: '2026-09-25T00:00:00.000Z',
  entries: FIXTURE_CHUNKS.map((chunk, index) => ({
    index: index + 1,
    chunk_id: chunk.id,
    title: chunk.title,
    start_seconds: chunk.start_time_seconds,
    end_seconds: chunk.end_time_seconds,
    text: chunk.transcript_text,
  })),
}

const TRANSCRIPT_MD = [
  `# Transcript — ${FIXTURE_VIDEO.title}`,
  '',
  '## [00:00 - 00:10] Opening',
  '',
  'The contract was signed on March third.',
  '',
  '## [00:10 - 00:20] Testimony',
  '',
  'The witness identified the signature.',
  '',
].join('\n')

const TRANSCRIPT_SRT = [
  '1',
  '00:00:00,000 --> 00:00:10,500',
  'The contract was signed on March third.',
  '',
  '2',
  '00:00:10,500 --> 00:00:20,000',
  'The witness identified the signature.',
  '',
].join('\n')

const TRANSCRIPT_VTT = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:10.500',
  'The contract was signed on March third.',
  '',
  '00:00:10.500 --> 00:00:20.000',
  'The witness identified the signature.',
  '',
].join('\n')

const TRANSCRIPT_BODIES = {
  json: JSON.stringify(FIXTURE_TRANSCRIPT_JSON, null, 2) + '\n',
  srt: TRANSCRIPT_SRT,
  vtt: TRANSCRIPT_VTT,
  md: TRANSCRIPT_MD,
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } })
}

async function readBody(request) {
  let raw = ''
  for await (const chunk of request) raw += chunk
  return raw.length > 0 ? JSON.parse(raw) : {}
}

/**
 * Creates the fixture http.Server (not started). Binds port 0 in tests via
 * `server.listen(0)`; direct runs pass --port.
 */
export function createFixtureServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://fixture.local')
    const path = url.pathname

    const auth = request.headers.authorization ?? ''
    if (!auth.startsWith(`Bearer ${FIXTURE_API_KEY_PREFIX}`)) {
      sendError(response, 401, 'unauthorized', 'Missing or invalid API key')
      return
    }

    if (request.method === 'POST' && path === '/api/v1/ingest') {
      const body = await readBody(request)
      if (body?.source?.type !== 'youtube' || typeof body?.source?.url !== 'string' || !body.source.url) {
        sendError(response, 400, 'invalid_source', 'source.type must be youtube with a url')
        return
      }
      sendJson(response, 202, {
        id: FIXTURE_INGESTED_VIDEO_ID,
        status: 'queued',
        status_url: `/api/v1/videos/${FIXTURE_INGESTED_VIDEO_ID}/status`,
      })
      return
    }

    const videoMatch = /^\/api\/v1\/videos\/([^/]+)(?:\/(status|transcript|chat))?$/.exec(path)
    if (videoMatch) {
      const [, videoId, action = 'status'] = videoMatch
      if (videoId !== FIXTURE_VIDEO_ID) {
        sendError(response, 404, 'video_not_found', 'Video not found')
        return
      }
      if (request.method === 'GET' && action === 'status') {
        sendJson(response, 200, { id: videoId, status: 'completed', progress: 100 })
        return
      }
      if (request.method === 'GET' && action === 'transcript') {
        const format = url.searchParams.get('format') ?? 'json'
        const body = TRANSCRIPT_BODIES[format]
        if (!body) {
          sendError(response, 400, 'invalid_format', `Unsupported format '${format}'. Supported formats: srt, vtt, md, json.`)
          return
        }
        const contentTypes = {
          json: 'application/json; charset=utf-8',
          srt: 'application/x-subrip; charset=utf-8',
          vtt: 'text/vtt; charset=utf-8',
          md: 'text/markdown; charset=utf-8',
        }
        response.writeHead(200, { 'content-type': contentTypes[format] })
        response.end(body)
        return
      }
      if (request.method === 'POST' && action === 'chat') {
        const body = await readBody(request)
        if (typeof body?.message !== 'string' || !body.message.trim()) {
          sendError(response, 400, 'invalid_request', 'message is required')
          return
        }
        sendJson(response, 200, FIXTURE_CHAT_RESPONSE)
        return
      }
    }

    if (request.method === 'POST' && path === '/api/v1/search') {
      const body = await readBody(request)
      if (typeof body?.query !== 'string' || !body.query.trim()) {
        sendError(response, 400, 'invalid_request', 'query is required')
        return
      }
      sendJson(response, 200, { ...FIXTURE_SEARCH_RESPONSE, query: body.query })
      return
    }

    sendError(response, 404, 'not_found', 'No fixture route for this request')
  })
}

function isDirectRun() {
  return process.argv[1]?.endsWith('mcp/fixtures/server.mjs')
}

if (isDirectRun()) {
  const portIndex = process.argv.indexOf('--port')
  const port = portIndex !== -1 ? Number(process.argv[portIndex + 1]) : Number(process.env.FIXTURE_PORT ?? 8977)
  const server = createFixtureServer()
  server.listen(port, '127.0.0.1', () => {
    console.error(`Fixture API v1 listening on http://127.0.0.1:${port}`)
  })
}
