import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { getVideoWithDetails, getChunkProvenance } from '@/lib/supabase/database'
import { buildChainOfCustodyManifest, ManifestError } from '@/lib/evidence/manifest'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // The custody record is evidence — library:read scope, org-scoped.
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

    const provenance = await getChunkProvenance(videoId)

    try {
      const manifest = buildChainOfCustodyManifest({
        video: {
          id: video.id,
          title: video.title,
          source_type: video.source_type,
          source_url: video.source_url ?? null,
          file_size_bytes: video.file_size_bytes ?? null,
          content_sha256: video.content_sha256 ?? null,
          content_hash_scope: video.content_hash_scope ?? null,
          created_at: video.created_at,
        },
        chunks: (video.chunks ?? []).map(chunk => ({
          id: chunk.id,
          start_time_seconds: chunk.start_time_seconds,
          end_time_seconds: chunk.end_time_seconds,
        })),
        // DB rows may omit the hash fields (legacy assets) — the manifest
        // reports them as explicit nulls, never undefined.
        provenance: provenance.map(row => ({
          ...row,
          source_sha256: row.source_sha256 ?? null,
          embedding_model: row.embedding_model ?? null,
        })),
        generatedAt: new Date().toISOString(),
      })

      return NextResponse.json(manifest)
    } catch (error) {
      // Incomplete custody is a typed 409 — never a silently partial manifest.
      if (error instanceof ManifestError) {
        return jsonError(409, error.code, error.message)
      }
      throw error
    }
  } catch (error) {
    console.error('Manifest API error:', error)
    return jsonError(500, 'internal_error', 'Internal server error')
  }
}
