import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
  ApiClient,
  ApiClientError,
  TRANSCRIPT_FORMATS,
  type TranscriptFormat,
} from './api-client'

// Tool + resource registration (spec art_HKWx4t5y §5). Every tool is one call
// into the API v1 client — no local pipeline logic. Errors from the API come
// back as isError results carrying the typed {error:{code,status,message}}
// body so an agent can react to the code; unexpected failures propagate.

export const MCP_SERVER_NAME = 'video-rag'
export const MCP_SERVER_VERSION = '0.1.0'

/** Text result carrying the API response as pretty JSON — machine-parseable. */
function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  }
}

/** Typed API failure as an isError result; never a fabricated success. */
function apiErrorResult(error: ApiClientError): CallToolResult {
  return {
    isError: true,
    content: [{
      type: 'text',
      text: JSON.stringify(
        { error: { code: error.code, status: error.status, message: error.message } },
        null,
        2,
      ),
    }],
  }
}

async function runTool(call: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await call())
  } catch (error) {
    if (error instanceof ApiClientError) return apiErrorResult(error)
    throw error
  }
}

/**
 * Registration helper pinning the SDK's tool generics to concrete types.
 *
 * Passing a concrete handler straight to server.registerTool exceeds
 * TypeScript's instantiation depth (SDK 1.30.1 + zod 3.25: the ToolCallback
 * conditional explores a zod v3|v4 type union per argument key until TS2589).
 * The helper keeps our compile-time contract — the handler's Args type is
 * inferred from the zod schema's output — and contains the two casts this
 * SDK version needs at the boundary. Runtime behavior is unchanged: the SDK
 * validates tool arguments against the same zod schema before calling the
 * handler, which the protocol tests verify end to end.
 */
function registerApiTool<Args>(
  server: McpServer,
  name: string,
  config: { title?: string; description?: string },
  inputSchema: z.ZodType<Args>,
  handler: (args: Args) => Promise<CallToolResult>,
): void {
  // zod object schemas expose .shape; the ZodType declaration does not.
  const { shape } = inputSchema as unknown as {
    shape: Record<string, z.ZodTypeAny>
  }
  server.registerTool(
    name,
    { ...config, inputSchema: shape },
    // The SDK expects its own ToolCallback conditional here; a typed handler
    // forces the compiler to resolve that conditional through the zod union
    // and blow the depth limit. The cast skips the check without changing
    // what runs.
    handler as never,
  )
}

/** Tool argument schemas — the single source of each tool's argument contract. */
const ingestVideoSchema = z.object({
  url: z.string().url().describe('YouTube video URL'),
  title: z.string().trim().min(1).optional().describe('Optional display title'),
  description: z.string().trim().min(1).optional().describe('Optional description'),
  idempotency_key: z.string().trim().min(1).optional().describe(
    'Optional idempotency key — a retry with the same key replays the first response',
  ),
})

const getVideoSchema = z.object({
  video_id: z.string().trim().min(1).describe('Video id (vid_… or uuid)'),
})

const searchSchema = z.object({
  query: z.string().trim().min(1).describe('Natural-language query'),
  video_ids: z.array(z.string().trim().min(1)).min(1).optional()
    .describe('Restrict the search to these video ids'),
  top_k: z.number().int().min(1).max(50).optional()
    .describe('Maximum results (default 10, max 50)'),
  min_similarity: z.number().min(0).max(1).optional()
    .describe('Minimum similarity floor (default 0.5, server-enforced)'),
})

const askVideoSchema = z.object({
  video_id: z.string().trim().min(1).describe('Video id to ask'),
  message: z.string().trim().min(1).describe('Question about the video'),
})

const getTranscriptSchema = z.object({
  video_id: z.string().trim().min(1).describe('Video id'),
  format: z.enum(TRANSCRIPT_FORMATS).default('json')
    .describe('Export format (default json)'),
})

export function registerTools(server: McpServer, client: ApiClient): void {
  registerApiTool(
    server,
    'ingest_video',
    {
      title: 'Ingest video',
      description:
        'Queue a YouTube video for evidence processing (transcribe → chunk → embed). ' +
        'Returns {id, status: "queued", status_url}; poll with get_video until completed.',
    },
    ingestVideoSchema,
    async ({ url, title, description, idempotency_key }) =>
      runTool(() => client.ingestVideo({ url, title, description, idempotencyKey: idempotency_key })),
  )

  registerApiTool(
    server,
    'get_video',
    {
      title: 'Get video status',
      description:
        'Get ingest/processing status for one video: status is ' +
        'uploading|processing|chunking|transcribing|embedding|completed|failed, ' +
        'with progress 0–100 and an error field when failed.',
    },
    getVideoSchema,
    async ({ video_id }) => runTool(() => client.getVideo(video_id)),
  )

  registerApiTool(
    server,
    'search',
    {
      title: 'Search transcript chunks',
      description:
        'Ranked semantic search over transcript chunks across the video library. ' +
        'Each result carries chunk_id, video_id, second-level offsets, the verbatim ' +
        'chunk text, and the similarity score.',
    },
    searchSchema,
    async ({ query, video_ids, top_k, min_similarity }) =>
      runTool(() => client.search({
        query,
        videoIds: video_ids,
        topK: top_k,
        minSimilarity: min_similarity,
      })),
  )

  registerApiTool(
    server,
    'ask_video',
    {
      title: 'Ask a video a question',
      description:
        'Ask one video a question and get an answer grounded in its transcript. ' +
        'Every source is a verbatim quote with chunk_id, seconds range, and similarity — ' +
        'cite those seconds, not the paraphrase.',
    },
    askVideoSchema,
    async ({ video_id, message }) => runTool(() => client.askVideo(video_id, message)),
  )

  registerApiTool(
    server,
    'get_transcript',
    {
      title: 'Get transcript',
      description:
        'Fetch one video\'s transcript with second-level timestamps. Formats: ' +
        'json (structured entries), srt, vtt, md (markdown).',
    },
    getTranscriptSchema,
    async ({ video_id, format }) => runTool(async () => {
      const body = await client.getTranscript(video_id, format as TranscriptFormat)
      // json format must be valid JSON — validate and pretty-print rather than
      // forwarding a body the agent cannot trust to parse.
      if (format === 'json') return JSON.parse(body) as unknown
      return { format, transcript: body }
    }),
  )
}

export function registerTranscriptResource(server: McpServer, client: ApiClient): void {
  server.registerResource(
    'video-transcript',
    new ResourceTemplate('video://{videoId}/transcript', { list: undefined }),
    {
      title: 'Video transcript',
      description: 'Timestamped markdown transcript for one video (second-level offsets).',
    },
    async (uri, { videoId }) => {
      // Template variables arrive as string | string[] depending on the client.
      const id = typeof videoId === 'string' ? videoId : videoId?.[0]
      if (!id) {
        throw new Error('Resource URI must include a videoId: video://{videoId}/transcript')
      }
      const markdown = await client.getTranscript(id, 'md')
      return {
        contents: [{
          uri: uri.toString(),
          mimeType: 'text/markdown; charset=utf-8',
          text: markdown,
        }],
      }
    },
  )
}

export function buildMcpServer(client: ApiClient): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        'Video evidence review tools. Ask questions with ask_video and cite the returned ' +
        "sources' seconds ranges (chunk_id + start/end_seconds + verbatim quote). " +
        'Use ingest_video for new YouTube sources, get_video to poll processing, ' +
        'search for cross-video retrieval, and get_transcript (or the ' +
        'video://{videoId}/transcript resource) for the full timestamped transcript.',
    },
  )
  registerTools(server, client)
  registerTranscriptResource(server, client)
  return server
}
