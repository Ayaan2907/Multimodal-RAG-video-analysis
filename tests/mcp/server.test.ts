import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createApiClient } from '@/mcp/api-client'
import { buildMcpServer } from '@/mcp/tools'
import {
  FIXTURE_CHAT_RESPONSE,
  FIXTURE_INGESTED_VIDEO_ID,
  FIXTURE_VIDEO_ID,
  createFixtureServer,
} from '@/mcp/fixtures/server.mjs'

// MCP protocol smoke test (spec art_HKWx4t5y §5 acceptance): the real MCP
// server implementation over an in-memory transport, exercising a real HTTP
// round trip against the fixture API v1 server — the same contract the
// inspector smoke run checks by hand.

let fixture: Server
let baseUrl: string
let client: Client

beforeAll(async () => {
  fixture = createFixtureServer()
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const { port } = fixture.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${port}`

  const server = buildMcpServer(createApiClient({ baseUrl, apiKey: 'vidrag_sk_fixture' }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)

  client = new Client({ name: 'vitest-mcp-client', version: '0.0.0' })
  await client.connect(clientTransport)
})

afterAll(() => {
  client.close()
  fixture.close()
})

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content[0]
  expect(block?.type).toBe('text')
  return block.text ?? ''
}

describe('MCP server tool surface', () => {
  it('registers exactly the five spec tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'ask_video',
      'get_transcript',
      'get_video',
      'ingest_video',
      'search',
    ])
  })
})

describe('MCP ask_video', () => {
  it('returns the answer+sources contract with verbatim-quote evidence', async () => {
    const result = await client.callTool({
      name: 'ask_video',
      arguments: { video_id: FIXTURE_VIDEO_ID, message: 'When was the contract signed?' },
    })
    expect(result.isError).toBeFalsy()

    const payload = JSON.parse(firstText(result as never))
    expect(typeof payload.answer).toBe('string')
    expect(payload.answer).toBe(FIXTURE_CHAT_RESPONSE.answer)
    expect(payload.sources).toHaveLength(1)
    expect(payload.sources[0]).toMatchObject({
      chunk_id: 'chunk_fixture_001',
      video_id: FIXTURE_VIDEO_ID,
      start_seconds: 0,
      end_seconds: 10.5,
      quote: 'The contract was signed on March third.',
      similarity: 0.91,
      matched_on: 'transcript',
    })
  })
})

describe('MCP ingest_video + get_video', () => {
  it('ingests a YouTube URL and polls status to the completed contract', async () => {
    const ingest = await client.callTool({
      name: 'ingest_video',
      arguments: { url: 'https://youtube.com/watch?v=fixture' },
    })
    expect(ingest.isError).toBeFalsy()
    expect(JSON.parse(firstText(ingest as never))).toEqual({
      id: FIXTURE_INGESTED_VIDEO_ID,
      status: 'queued',
      status_url: `/api/v1/videos/${FIXTURE_INGESTED_VIDEO_ID}/status`,
    })

    const status = await client.callTool({
      name: 'get_video',
      arguments: { video_id: FIXTURE_VIDEO_ID },
    })
    expect(status.isError).toBeFalsy()
    expect(JSON.parse(firstText(status as never))).toMatchObject({
      id: FIXTURE_VIDEO_ID,
      status: 'completed',
      progress: 100,
    })
  })
})

describe('MCP search + get_transcript', () => {
  it('returns ranked results and the structured transcript', async () => {
    const search = await client.callTool({
      name: 'search',
      arguments: { query: 'contract signing', top_k: 5 },
    })
    expect(search.isError).toBeFalsy()
    const searchPayload = JSON.parse(firstText(search as never))
    expect(searchPayload.query).toBe('contract signing')
    expect(searchPayload.results[0]).toMatchObject({
      chunk_id: 'chunk_fixture_001',
      start_seconds: 0,
      end_seconds: 10.5,
      similarity: 0.89,
    })

    const transcript = await client.callTool({
      name: 'get_transcript',
      arguments: { video_id: FIXTURE_VIDEO_ID },
    })
    expect(transcript.isError).toBeFalsy()
    const transcriptPayload = JSON.parse(firstText(transcript as never))
    expect(transcriptPayload.video_id).toBe(FIXTURE_VIDEO_ID)
    expect(transcriptPayload.entries).toHaveLength(2)
    expect(transcriptPayload.entries[0]).toMatchObject({
      chunk_id: 'chunk_fixture_001',
      start_seconds: 0,
      end_seconds: 10.5,
    })
  })

  it('serves markdown transcripts through srt/vtt/md formats', async () => {
    const markdown = await client.callTool({
      name: 'get_transcript',
      arguments: { video_id: FIXTURE_VIDEO_ID, format: 'md' },
    })
    expect(markdown.isError).toBeFalsy()
    const payload = JSON.parse(firstText(markdown as never))
    expect(payload.format).toBe('md')
    expect(payload.transcript).toContain('## [00:00 - 00:10] Opening')
  })
})

describe('MCP transcript resource', () => {
  it('serves video://{id}/transcript as timestamped markdown', async () => {
    const resource = await client.readResource({ uri: `video://${FIXTURE_VIDEO_ID}/transcript` })
    const content = resource.contents[0]
    expect('text' in content).toBe(true)
    if (!('text' in content)) throw new Error('expected text resource content')
    expect(content.mimeType).toContain('text/markdown')
    expect(content.text).toContain('# Transcript — Deposition — Day 1')
    expect(content.text).toContain('The witness identified the signature.')
  })
})

describe('MCP error surfacing', () => {
  it('maps an unknown video to an isError result carrying the typed code', async () => {
    const result = await client.callTool({
      name: 'get_video',
      arguments: { video_id: 'vid_missing' },
    })
    expect(result.isError).toBe(true)
    const payload = JSON.parse(firstText(result as never))
    expect(payload.error).toMatchObject({ code: 'video_not_found', status: 404 })
  })

  it('maps a missing API key to an unauthorized isError result', async () => {
    const unauthenticated = buildMcpServer(createApiClient({
      baseUrl,
      apiKey: 'not-a-fixture-key',
    }))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await unauthenticated.connect(serverTransport)
    const badClient = new Client({ name: 'vitest-bad-key', version: '0.0.0' })
    await badClient.connect(clientTransport)

    const result = await badClient.callTool({
      name: 'ask_video',
      arguments: { video_id: FIXTURE_VIDEO_ID, message: 'hello?' },
    })
    expect(result.isError).toBe(true)
    expect(firstText(result as never)).toContain('unauthorized')

    badClient.close()
    unauthenticated.close()
  })
})
