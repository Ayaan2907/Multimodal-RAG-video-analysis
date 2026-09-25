import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateTextEmbedding } from '@/lib/ai/embeddings'
import { groq } from '@ai-sdk/groq'
import { generateText, streamText } from 'ai'
import type { NextRequest } from 'next/server'
import { jsonError } from '@/lib/api/http'
import { getGroqChatModel, getMatchThreshold } from '@/lib/config'
import { getVideoById } from '@/lib/supabase/database'
import { buildChatSources, type ChatSource, type ChatSourceMatch } from '@/lib/evidence/chat-sources'
import { formatClockTimestamp } from '@/lib/export/transcript'
import type { AuthContext } from '@/lib/auth/request'

// Chat evidence handler shared by POST /api/v1/videos/{id}/chat and
// POST /api/v1/chat (spec art_HKWx4t5y §4).
//
// Evidence contract: every source is a verbatim transcript span built by
// buildChatSources; when retrieval finds nothing above threshold the answer
// declines with sources: [] — an answer is never served from a generic LLM
// fallback with no evidence behind it (that path from the legacy route does
// not port to v1). Provider failures are typed 5xx, never degraded success.

interface ChatRequestBody {
  videoId?: unknown
  message?: unknown
  stream?: unknown
}

export interface VideoChatRequest {
  message: string
  stream: boolean
}

type ParsedChatRequest =
  | { ok: true; parsed: VideoChatRequest }
  | { ok: false; status: 400; code: string; message: string }

export function parseChatRequestBody(body: unknown, videoIdFromPath?: string): ParsedChatRequest {
  if (body === null || typeof body !== 'object') {
    return { ok: false, status: 400, code: 'invalid_request', message: 'Request body must be a JSON object' }
  }
  const { message, stream } = body as ChatRequestBody

  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, status: 400, code: 'invalid_request', message: 'message is required' }
  }

  if (videoIdFromPath === undefined) {
    const { videoId } = body as ChatRequestBody
    if (typeof videoId !== 'string' || !videoId.trim()) {
      return { ok: false, status: 400, code: 'invalid_request', message: 'videoId is required' }
    }
  }

  return {
    ok: true,
    parsed: { message: message.trim(), stream: stream === true },
  }
}

export const NO_EVIDENCE_ANSWER = 'No transcript evidence in this video matches the question.'

interface MatchedEmbedding {
  id: string
  video_id: string
  chunk_id: string
  content_type: 'transcript' | 'visual' | 'multimodal'
  content_text: string
  similarity: number
  metadata?: Record<string, unknown>
}

interface VideoChunkRow {
  id: string
  video_id: string
  title: string | null
  start_time_seconds: number
  end_time_seconds: number
  transcript_text: string | null
}

export async function handleVideoChat(
  request: NextRequest,
  auth: AuthContext,
  videoIdFromPath?: string,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError(400, 'invalid_request', 'Request body must be valid JSON')
  }

  const parsed = parseChatRequestBody(body, videoIdFromPath)
  if (!parsed.ok) {
    return jsonError(parsed.status, parsed.code, parsed.message)
  }
  const { message, stream } = parsed.parsed
  const videoId = videoIdFromPath ?? (body as ChatRequestBody).videoId as string

  // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
  const video = await getVideoById(videoId, auth.organizationId)
  if (!video) {
    return jsonError(404, 'video_not_found', 'Video not found')
  }

  const { embedding: queryEmbedding, error: queryEmbeddingError } = await generateTextEmbedding(message)
  if (queryEmbeddingError || !queryEmbedding || queryEmbedding.length === 0) {
    return jsonError(500, 'query_embedding_failed', 'Failed to understand query')
  }

  const { data: matchedEmbeddingsData, error: matchError } = await supabaseAdmin.rpc('match_embeddings', {
    query_embedding: queryEmbedding,
    match_threshold: getMatchThreshold(),
    match_count: 5,
    filter_video_id: videoId,
  })

  if (matchError) {
    // Typed retrieval failure — the legacy generic-LLM fallback would answer
    // without evidence, which v1 refuses to do.
    console.error('v1 chat: match_embeddings RPC failed')
    return jsonError(500, 'retrieval_failed', 'Evidence retrieval failed')
  }

  const matchedEmbeddings: MatchedEmbedding[] = matchedEmbeddingsData ?? []
  const uniqueChunkIds = [...new Set(matchedEmbeddings.map(e => e.chunk_id))]

  let chunkRows: VideoChunkRow[] = []
  if (uniqueChunkIds.length > 0) {
    const { data: fetchedChunks } = await supabaseAdmin
      .from('video_chunks')
      .select('id, video_id, title, start_time_seconds, end_time_seconds, transcript_text')
      .in('id', uniqueChunkIds)
      .returns<VideoChunkRow[]>()
    chunkRows = fetchedChunks ?? []
  }

  if (chunkRows.length === 0) {
    return Response.json({ answer: NO_EVIDENCE_ANSWER, sources: [] })
  }

  // Evidence anchoring: the stored transcript (content + segments) backs every
  // returned quote as a verbatim span.
  const [{ data: transcriptRow }, { data: segmentRows }] = await Promise.all([
    supabaseAdmin.from('transcripts').select('content').eq('video_id', videoId).maybeSingle<{ content: string | null }>(),
    supabaseAdmin
      .from('transcript_segments')
      .select('text_content, start_time_seconds, end_time_seconds')
      .eq('video_id', videoId)
      .order('start_time_seconds', { ascending: true }),
  ])

  const bestMatchForChunk = new Map<string, MatchedEmbedding>()
  for (const match of matchedEmbeddings) {
    const current = bestMatchForChunk.get(match.chunk_id)
    if (!current || match.similarity > current.similarity) {
      bestMatchForChunk.set(match.chunk_id, match)
    }
  }

  const sourceMatches: ChatSourceMatch[] = chunkRows.map(chunk => {
    const matchedEmbedding = bestMatchForChunk.get(chunk.id)
    return {
      chunkId: chunk.id,
      title: chunk.title,
      startSeconds: chunk.start_time_seconds,
      endSeconds: chunk.end_time_seconds,
      contentType: matchedEmbedding?.content_type ?? 'transcript',
      similarity: matchedEmbedding?.similarity ?? 0,
      matchedText: matchedEmbedding?.content_text ?? null,
      chunkTranscriptText: chunk.transcript_text,
    }
  })

  const sources: ChatSource[] = buildChatSources({
    videoId,
    matches: sourceMatches,
    fullTranscript: transcriptRow?.content ?? '',
    segments: (segmentRows ?? []).map(seg => ({
      text: seg.text_content,
      startSeconds: seg.start_time_seconds,
      endSeconds: seg.end_time_seconds,
    })),
  })

  const contextString = buildContextString(chunkRows, bestMatchForChunk)
  const systemPrompt =
    "You are a helpful AI assistant. Answer the user's question based ONLY on the provided video segments. If the answer cannot be found in the provided segments, clearly state that. When possible, reference the time codes (e.g., \"from Xs to Ys\") of the video segments that support your answer."
  const fullPrompt = `${systemPrompt}\n\n${contextString}\n\nUser Question: ${message}\n\nAssistant Answer:`
  const model = groq(getGroqChatModel())

  if (stream) {
    return streamAnswerAsSse(model, fullPrompt, sources)
  }

  try {
    const llmResponse = await generateText({ model, prompt: fullPrompt })
    return Response.json({ answer: llmResponse.text, sources })
  } catch (error) {
    console.error('v1 chat: generation failed:', error)
    return jsonError(500, 'generation_failed', 'Answer generation failed')
  }
}

function buildContextString(
  chunkRows: VideoChunkRow[],
  bestMatchForChunk: Map<string, MatchedEmbedding>,
): string {
  const contextParts = chunkRows.map(chunk => {
    const matchedEmbedding = bestMatchForChunk.get(chunk.id)
    const lines = [
      `Segment (Chunk ID: ${chunk.id}):`,
      `Title: ${chunk.title || 'N/A'}`,
      `Time: ${formatClockTimestamp(chunk.start_time_seconds)} - ${formatClockTimestamp(chunk.end_time_seconds)}`,
    ]
    if (matchedEmbedding) {
      lines.push(
        `Matched Content (${matchedEmbedding.content_type} with similarity ${matchedEmbedding.similarity.toFixed(2)}):`,
        matchedEmbedding.content_text,
      )
    }
    if (chunk.transcript_text && chunk.transcript_text !== matchedEmbedding?.content_text) {
      lines.push('Full Transcript for this segment:', chunk.transcript_text)
    }
    return lines.join('\n')
  })
  return ['Provided Video Segments:', '---', ...contextParts, '---'].join('\n')
}

// ---------------------------------------------------------------------------
// SSE streaming — sources ride first (clients can render citations before the
// first token), then answer deltas, then done. Mid-stream failures emit a
// typed error event; the stream never fabricates content.
// ---------------------------------------------------------------------------

function sseEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`)
}

function streamAnswerAsSse(
  model: Parameters<typeof streamText>[0]['model'],
  prompt: string,
  sources: ChatSource[],
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(sseEvent({ type: 'sources', sources }))
        const result = streamText({ model, prompt })
        for await (const delta of result.textStream) {
          controller.enqueue(sseEvent({ type: 'answer.delta', text: delta }))
        }
        controller.enqueue(sseEvent({ type: 'done' }))
      } catch (error) {
        console.error('v1 chat: streaming generation failed:', error)
        controller.enqueue(
          sseEvent({ type: 'error', error: { code: 'generation_failed', message: 'Answer generation failed' } }),
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  })
}
