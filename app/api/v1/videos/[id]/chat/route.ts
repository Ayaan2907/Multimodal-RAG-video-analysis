import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { handleVideoChat } from '@/lib/api/chat'

// POST /api/v1/videos/{id}/chat — ask one video a question (spec art_HKWx4t5y
// §4). {message, stream?} → {answer, sources} with verbatim-quote sources, or
// an SSE event stream when stream:true.

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateRequest(request, 'chat:run')
    if (!auth.ok) return authErrorResponse(auth)

    const { id: videoId } = await params
    if (!videoId) {
      return jsonError(400, 'missing_video_id', 'Video ID is required')
    }

    return await handleVideoChat(request, auth.context, videoId)
  } catch (error) {
    console.error('v1 chat API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
