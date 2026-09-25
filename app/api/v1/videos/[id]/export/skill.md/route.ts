import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { getVideoWithDetails } from '@/lib/supabase/database'
import { buildSkillPackageZip } from '@/lib/export/skill-package'

// GET /api/v1/videos/{id}/export/skill.md — agent-ready evidence zip
// (spec art_HKWx4t5y §4): SKILL.md + references/transcript.md +
// references/chunks.jsonl for one video.

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Library content in packaged form — library:read scope, org-scoped.
    const auth = await authenticateRequest(request, 'library:read')
    if (!auth.ok) return authErrorResponse(auth)

    const { id: videoId } = await params
    if (!videoId) {
      return jsonError(400, 'missing_video_id', 'Video ID is required')
    }

    // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
    const video = await getVideoWithDetails(videoId, auth.context.organizationId)
    if (!video) {
      return jsonError(404, 'video_not_found', 'Video not found')
    }

    const zip = buildSkillPackageZip(
      { video, chunks: video.chunks ?? [], segments: video.transcriptSegments ?? [] },
      { origin: request.nextUrl.origin },
    )

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="skill-${videoId}.md.zip"`,
      },
    })
  } catch (error) {
    console.error('Skill export API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
