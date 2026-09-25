import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { buildStatusResponse } from '@/lib/api/v1-contracts'
import { getVideoById } from '@/lib/supabase/database'

// GET /api/v1/videos/{id}/status — poll ingest progress (spec art_HKWx4t5y §4).
// status is the processing enum: uploading|processing|chunking|transcribing
// |embedding|completed|failed (+progress percentage, +error when failed).

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request, 'library:read')
    if (!auth.ok) return authErrorResponse(auth)

    const { id: videoId } = await params
    if (!videoId) {
      return jsonError(400, 'missing_video_id', 'Video ID is required')
    }

    // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
    const video = await getVideoById(videoId, auth.context.organizationId)
    if (!video) {
      return jsonError(404, 'video_not_found', 'Video not found')
    }

    const status = buildStatusResponse(video)
    if (!status) {
      // An unknown status value means the pipeline and the API contract have
      // drifted — a typed 500, not a fabricated status.
      return jsonError(500, 'status_contract_violation', 'Video status does not match the API contract')
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('Status API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
