// Thin typed client of API v1 (spec art_HKWx4t5y §5). The MCP server owns no
// business logic: every tool call is one HTTP request against the versioned
// surface — org API key auth via env, no direct database access, no pipeline
// reimplementation. Response types are client-side mirrors of the server's
// contracts (lib/api/v1-contracts.ts, lib/api/chat.ts, lib/api/http.ts).

const YOUTUBE_SOURCE_TYPE = 'youtube'

export class ApiClientError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(`API v1 ${status} ${code}: ${message}`)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
  }
}

/** Server contract: POST /api/v1/ingest (lib/api/v1-contracts.ts). */
export interface IngestAcceptedResponse {
  id: string
  status: 'queued'
  status_url: string
}

/** Server contract: processing status enum (lib/api/v1-contracts.ts). */
export type ProcessingStatus =
  | 'uploading'
  | 'processing'
  | 'chunking'
  | 'transcribing'
  | 'embedding'
  | 'completed'
  | 'failed'

/** Server contract: GET /api/v1/videos/{id}/status. */
export interface VideoStatusResponse {
  id: string
  status: ProcessingStatus
  progress: number
  error?: string
}

/** Server contract: verbatim-quote evidence source (lib/evidence/chat-sources.ts). */
export interface ChatSource {
  chunk_id: string
  video_id: string
  start_seconds: number
  end_seconds: number
  quote: string
  similarity: number
  title: string | null
  matched_on: 'transcript' | 'visual' | 'multimodal'
}

/** Server contract: POST /api/v1/videos/{id}/chat (non-streaming). */
export interface ChatResponse {
  answer: string
  sources: ChatSource[]
}

/** Server contract: POST /api/v1/search results. */
export interface SearchResult {
  video_id: string
  chunk_id: string
  title: string | null
  content_type: 'transcript' | 'visual' | 'multimodal'
  content_text: string
  start_seconds: number | null
  end_seconds: number | null
  similarity: number
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
}

export const TRANSCRIPT_FORMATS = ['json', 'srt', 'vtt', 'md'] as const
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number]

export interface ApiClientConfig {
  /** API origin, e.g. https://api.example.com — /api/v1/* is appended. */
  baseUrl: string
  /** Organization API key (vidrag_sk_…), sent as a Bearer token. */
  apiKey: string
  fetchImpl?: typeof fetch
}

export interface IngestVideoInput {
  /** YouTube URL; file ingest stays multipart-only on the server. */
  url: string
  title?: string
  description?: string
  /** Replays the first 202 response instead of double-ingesting. */
  idempotencyKey?: string
}

export interface SearchInput {
  query: string
  videoIds?: string[]
  topK?: number
  minSimilarity?: number
}

export class ApiClient {
  private readonly baseUrl: URL
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch

  constructor(config: ApiClientConfig) {
    this.baseUrl = new URL(config.baseUrl)
    this.apiKey = config.apiKey
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  async ingestVideo(input: IngestVideoInput): Promise<IngestAcceptedResponse> {
    const headers: Record<string, string> = {}
    if (input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey
    return this.requestJson('POST', '/api/v1/ingest', {
      source: { type: YOUTUBE_SOURCE_TYPE, url: input.url },
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    }, headers)
  }

  async getVideo(videoId: string): Promise<VideoStatusResponse> {
    return this.requestJson('GET', `/api/v1/videos/${encodeURIComponent(videoId)}/status`)
  }

  async askVideo(videoId: string, message: string): Promise<ChatResponse> {
    return this.requestJson('POST', `/api/v1/videos/${encodeURIComponent(videoId)}/chat`, { message })
  }

  async search(input: SearchInput): Promise<SearchResponse> {
    return this.requestJson('POST', '/api/v1/search', {
      query: input.query,
      ...(input.videoIds ? { video_ids: input.videoIds } : {}),
      ...(input.topK !== undefined ? { top_k: input.topK } : {}),
      ...(input.minSimilarity !== undefined ? { min_similarity: input.minSimilarity } : {}),
    })
  }

  /** Raw transcript body; `json` format is the structured export contract. */
  async getTranscript(videoId: string, format: TranscriptFormat = 'json'): Promise<string> {
    const response = await this.request(
      'GET',
      `/api/v1/videos/${encodeURIComponent(videoId)}/transcript?format=${encodeURIComponent(format)}`,
    )
    if (!response.ok) throw await parseErrorResponse(response)
    return response.text()
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const response = await this.request(method, path, body, headers)
    if (!response.ok) throw await parseErrorResponse(response)
    try {
      return await response.json() as T
    } catch {
      throw new ApiClientError(response.status, 'invalid_response', 'Response body was not valid JSON')
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    try {
      return await this.fetchImpl(new URL(path, this.baseUrl), {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (error) {
      if (error instanceof ApiClientError) throw error
      const message = error instanceof Error ? error.message : 'Request failed'
      throw new ApiClientError(0, 'network_error', message)
    }
  }
}

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  // Server error bodies are {error:{code,message}} (lib/api/http.ts); a
  // non-JSON body falls back to a generic code rather than hiding the status.
  let code = 'http_error'
  let message = `Unexpected response status ${response.status}`
  try {
    const body = await response.json() as { error?: { code?: unknown; message?: unknown } }
    if (typeof body?.error?.code === 'string' && typeof body?.error?.message === 'string') {
      code = body.error.code
      message = body.error.message
    }
  } catch {
    // Non-JSON error body — keep the generic code and status.
  }
  return new ApiClientError(response.status, code, message)
}

export interface McpEnvConfig {
  baseUrl: string
  apiKey: string
}

/** Reads VIDEO_RAG_API_URL + VIDEO_RAG_API_KEY; throws a plain Error when absent. */
export function readApiConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): McpEnvConfig {
  const baseUrl = env.VIDEO_RAG_API_URL?.trim()
  const apiKey = env.VIDEO_RAG_API_KEY?.trim()
  if (!baseUrl) {
    throw new Error('VIDEO_RAG_API_URL is required (API origin, e.g. https://api.example.com)')
  }
  if (!apiKey) {
    throw new Error('VIDEO_RAG_API_KEY is required (organization API key, vidrag_sk_…)')
  }
  new URL(baseUrl) // throws on a malformed origin before the server starts
  return { baseUrl, apiKey }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config)
}
