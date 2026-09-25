import { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { handleVideoChat } from '@/lib/api/chat'

// POST /api/v1/chat — ask one video a question, videoId in the body
// (spec art_HKWx4t5y §4). Same contract as POST /api/v1/videos/{id}/chat.

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, 'chat:run')
    if (!auth.ok) return authErrorResponse(auth)

    return await handleVideoChat(request, auth.context)
  } catch (error) {
    console.error('v1 chat API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
