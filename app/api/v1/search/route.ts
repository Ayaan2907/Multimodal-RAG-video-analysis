import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { generateTextEmbedding } from '@/lib/ai/embeddings'
import { getMatchThreshold } from '@/lib/config'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST /api/v1/search — ranked chunk retrieval across the org's library
// (spec art_HKWx4t5y §4). {query, video_ids?, top_k?, min_similarity?} —
// min_similarity defaults to the configured floor (0.5), enforced server-side
// by the org-scoped match_embeddings_org RPC so results can never leak across
// organizations.

export const dynamic = 'force-dynamic'

const DEFAULT_TOP_K = 10
const MAX_TOP_K = 50

interface SearchRequestBody {
  query?: unknown
  video_ids?: unknown
  top_k?: unknown
  min_similarity?: unknown
}

interface MatchedEmbedding {
  id: string
  video_id: string
  chunk_id: string
  content_type: 'transcript' | 'visual' | 'multimodal'
  content_text: string
  metadata?: Record<string, unknown>
  similarity: number
}

interface ChunkRow {
  id: string
  title: string | null
  start_time_seconds: number
  end_time_seconds: number
}

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

export async function POST(request: NextRequest) {
  try {
    // Search reads library content but executes the model + RPC pipeline —
    // the same billing surface as chat, so chat:run guards it.
    const auth = await authenticateRequest(request, 'chat:run')
    if (!auth.ok) return authErrorResponse(auth)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonError(400, 'invalid_request', 'Request body must be valid JSON')
    }

    if (body === null || typeof body !== 'object') {
      return jsonError(400, 'invalid_request', 'Request body must be a JSON object')
    }

    const { query, video_ids, top_k, min_similarity } = body as SearchRequestBody

    if (typeof query !== 'string' || !query.trim()) {
      return jsonError(400, 'invalid_request', 'query is required')
    }

    let videoIdFilter: string[] | undefined
    if (video_ids !== undefined) {
      if (!Array.isArray(video_ids) || video_ids.some(id => typeof id !== 'string' || !id.trim())) {
        return jsonError(400, 'invalid_request', 'video_ids must be an array of video ids')
      }
      videoIdFilter = video_ids as string[]
    }

    let topK = DEFAULT_TOP_K
    if (top_k !== undefined) {
      if (typeof top_k !== 'number' || !Number.isInteger(top_k) || top_k < 1 || top_k > MAX_TOP_K) {
        return jsonError(400, 'invalid_request', `top_k must be an integer between 1 and ${MAX_TOP_K}`)
      }
      topK = top_k
    }

    let threshold = getMatchThreshold()
    if (min_similarity !== undefined) {
      if (typeof min_similarity !== 'number' || !Number.isFinite(min_similarity) || min_similarity <= 0 || min_similarity >= 1) {
        return jsonError(400, 'invalid_request', 'min_similarity must be a number strictly between 0 and 1')
      }
      threshold = min_similarity
    }

    const { embedding: queryEmbedding, error: queryEmbeddingError } = await generateTextEmbedding(query)
    if (queryEmbeddingError || !queryEmbedding || queryEmbedding.length === 0) {
      return jsonError(500, 'query_embedding_failed', 'Failed to understand query')
    }

    // Org scope is a mandatory RPC parameter — filtering after ranking would
    // expose cross-org similarity rows; this cannot.
    const { data: matchedData, error: matchError } = await supabaseAdmin.rpc('match_embeddings_org', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: topK,
      p_organization_id: auth.context.organizationId,
      p_video_ids: videoIdFilter ?? null,
    })

    if (matchError) {
      console.error('v1 search: match_embeddings_org RPC failed')
      return jsonError(500, 'retrieval_failed', 'Search retrieval failed')
    }

    const matched: MatchedEmbedding[] = matchedData ?? []

    // Best embedding per chunk, ranked — the unit of evidence is the chunk.
    const bestPerChunk = new Map<string, MatchedEmbedding>()
    for (const match of matched) {
      const current = bestPerChunk.get(match.chunk_id)
      if (!current || match.similarity > current.similarity) {
        bestPerChunk.set(match.chunk_id, match)
      }
    }

    const chunkIds = [...bestPerChunk.keys()]
    const chunkRows = new Map<string, ChunkRow>()
    if (chunkIds.length > 0) {
      const { data: chunks } = await supabaseAdmin
        .from('video_chunks')
        .select('id, title, start_time_seconds, end_time_seconds')
        .in('id', chunkIds)
        .returns<ChunkRow[]>()
      for (const chunk of chunks ?? []) {
        chunkRows.set(chunk.id, chunk)
      }
    }

    const results: SearchResult[] = chunkIds
      .map(chunkId => {
        const match = bestPerChunk.get(chunkId)!
        const chunk = chunkRows.get(chunkId)
        return {
          video_id: match.video_id,
          chunk_id: match.chunk_id,
          title: chunk?.title ?? null,
          content_type: match.content_type,
          content_text: match.content_text,
          start_seconds: chunk?.start_time_seconds ?? null,
          end_seconds: chunk?.end_time_seconds ?? null,
          similarity: match.similarity,
        }
      })
      .sort((a, b) => b.similarity - a.similarity)

    return NextResponse.json({ query, results })
  } catch (error) {
    console.error('v1 search API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
