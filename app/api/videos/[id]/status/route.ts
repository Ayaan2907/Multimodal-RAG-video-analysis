import { NextRequest, NextResponse } from 'next/server'
import { getVideoStatus } from '@/lib/video/processing'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth first — processing state is only visible to the owning org's keys.
    const auth = await authenticateRequest(request, 'library:read')
    if (!auth.ok) return authErrorResponse(auth)

    const { id: videoId } = await params

    if (!videoId) {
      return jsonError(400, 'missing_video_id', 'Video ID is required')
    }

    // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
    const status = await getVideoStatus(videoId, auth.context.organizationId)

    if (!status) {
      return jsonError(404, 'video_not_found', 'Video not found')
    }

    return NextResponse.json(status)

  } catch (error) {
    console.error('Status API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
