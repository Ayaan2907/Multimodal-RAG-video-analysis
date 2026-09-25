import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { buildIngestAcceptedResponse } from '@/lib/api/v1-contracts'
import {
  findIdempotentIngest,
  IDEMPOTENCY_KEY_HEADER,
  recordIdempotentIngest,
} from '@/lib/api/idempotency'
import { createUploadIngest, createYoutubeIngest } from '@/lib/ingest/async'

// POST /api/v1/ingest — async-first ingest (spec art_HKWx4t5y §4).
// JSON body {source:{type:'youtube',url}} or multipart file. Answers 202 with
// {id, status:'queued', status_url} the moment the record exists; processing
// continues in the background. An Idempotency-Key header replays the first
// response instead of double-ingesting.

export const dynamic = 'force-dynamic'

const YOUTUBE_SOURCE_TYPE = 'youtube'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, 'ingest:write')
    if (!auth.ok) return authErrorResponse(auth)

    const contentType = request.headers.get('content-type') ?? ''
    const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim() || null

    // Replay check happens before ingest: a duplicate submit must not create a
    // second video row it then has to orphan.
    if (idempotencyKey) {
      const existing = await findIdempotentIngest(auth.context.organizationId, idempotencyKey)
      if (existing) {
        return NextResponse.json(buildIngestAcceptedResponse(existing.videoId), { status: 202 })
      }
    }

    const result = await performIngest(request, auth.context.organizationId, contentType)

    if (!result.ok) {
      // Validation failures never consume an idempotency key — only a created
      // video does. A retry with the same key after a 4xx is a fresh attempt.
      return jsonError(validationStatus(result.validation.code), result.validation.code, result.validation.message)
    }

    if (idempotencyKey) {
      const recorded = await recordIdempotentIngest(auth.context.organizationId, idempotencyKey, result.videoId)
      if (!recorded) {
        // Concurrent duplicate lost the key race: the first request owns this
        // key, so answer with its video id.
        const existing = await findIdempotentIngest(auth.context.organizationId, idempotencyKey)
        if (existing) {
          return NextResponse.json(buildIngestAcceptedResponse(existing.videoId), { status: 202 })
        }
        // Recording failed for a non-race reason (e.g. key store down) — the
        // video exists, so accept it without idempotency coverage.
        console.error('Ingest idempotency recording failed; accepting without replay coverage')
      }
    }

    return NextResponse.json(buildIngestAcceptedResponse(result.videoId), { status: 202 })
  } catch (error) {
    console.error('Ingest API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}

async function performIngest(
  request: NextRequest,
  organizationId: string,
  contentType: string,
): Promise<{ ok: true; videoId: string; /** Pre-resolved idempotent replay, if any. */ } | { ok: false; validation: { code: string; message: string } }> {
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    const title = typeof formData.get('title') === 'string' ? (formData.get('title') as string) : undefined
    const description =
      typeof formData.get('description') === 'string' ? (formData.get('description') as string) : undefined

    if (!(file instanceof File)) {
      return { ok: false, validation: { code: 'missing_file', message: 'No file provided' } }
    }

    const result = await createUploadIngest({ organizationId, file, title, description })
    return result.ok ? { ok: true, videoId: result.videoId } : { ok: false, validation: result.validation }
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { ok: false, validation: { code: 'invalid_request', message: 'Request body must be valid JSON' } }
  }

  if (body === null || typeof body !== 'object') {
    return { ok: false, validation: { code: 'invalid_request', message: 'Request body must be a JSON object' } }
  }

  const source = (body as { source?: { type?: unknown; url?: unknown } }).source
  if (!source || source.type !== YOUTUBE_SOURCE_TYPE) {
    return {
      ok: false,
      validation: { code: 'invalid_source', message: `source.type must be '${YOUTUBE_SOURCE_TYPE}' for JSON ingest; file ingest is multipart/form-data` },
    }
  }
  if (typeof source.url !== 'string' || !source.url.trim()) {
    return { ok: false, validation: { code: 'missing_url', message: 'YouTube URL is required' } }
  }

  const payload = body as { source: { type: string; url: string }; title?: string; description?: string }
  const result = await createYoutubeIngest({
    organizationId,
    url: payload.source.url,
    title: payload.title,
    description: payload.description,
  })
  return result.ok ? { ok: true, videoId: result.videoId } : { ok: false, validation: result.validation }
}

function validationStatus(code: string): number {
  // File/URL shape problems are client errors; environment problems are not
  // the caller's fault and must not read as one.
  return code === 'database_error' || code === 'ffmpeg_unavailable' ? 500 : 400
}
