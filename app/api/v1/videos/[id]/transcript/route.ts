import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { getVideoWithDetails } from '@/lib/supabase/database'
import {
  buildTranscriptExport,
  EXPORT_CONTENT_TYPES,
  isTranscriptExportFormat,
} from '@/lib/export/transcript'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Transcript content is evidence — library:read scope, org-scoped.
    const auth = await authenticateRequest(request, 'library:read')
    if (!auth.ok) return authErrorResponse(auth)

    const { id: videoId } = await params
    if (!videoId) {
      return jsonError(400, 'missing_video_id', 'Video ID is required')
    }

    const formatParam = request.nextUrl.searchParams.get('format') ?? 'json'
    if (!isTranscriptExportFormat(formatParam)) {
      return jsonError(
        400,
        'invalid_format',
        `Unsupported format '${formatParam}'. Supported formats: srt, vtt, md, json.`
      )
    }

    // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
    const video = await getVideoWithDetails(videoId, auth.context.organizationId)
    if (!video) {
      return jsonError(404, 'video_not_found', 'Video not found')
    }

    const body = buildTranscriptExport(
      { video, chunks: video.chunks ?? [], segments: video.transcriptSegments ?? [] },
      formatParam,
    )

    const response = new NextResponse(body, {
      status: 200,
      headers: { 'Content-Type': EXPORT_CONTENT_TYPES[formatParam] },
    })

    if (request.nextUrl.searchParams.get('download')) {
      response.headers.set(
        'Content-Disposition',
        `attachment; filename="transcript-${videoId}.${formatParam}"`
      )
    }

    return response
  } catch (error) {
    console.error('Transcript export API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
