import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Idempotency for POST /api/v1/ingest (spec art_HKWx4t5y §4).
// One (org, endpoint, key) triple maps to the video the first request created;
// a replay — including a concurrent one, via the unique constraint — gets the
// original video id back instead of a second ingest.

export const INGEST_IDEMPOTENCY_ENDPOINT = 'POST /api/v1/ingest'
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'

export interface IdempotentIngestRecord {
  videoId: string
}

/** The recorded video for this key, if a prior request already ingested it. */
export async function findIdempotentIngest(
  organizationId: string,
  idempotencyKey: string,
  endpoint: string = INGEST_IDEMPOTENCY_ENDPOINT,
): Promise<IdempotentIngestRecord | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('idempotency_keys')
      .select('video_id')
      .eq('organization_id', organizationId)
      .eq('endpoint', endpoint)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle<{ video_id: string | null }>()

    if (error) {
      console.error('Idempotency lookup failed:', error)
      return null
    }

    if (!data?.video_id) return null
    return { videoId: data.video_id }
  } catch (error) {
    console.error('Idempotency lookup failed:', error)
    return null
  }
}

/**
 * Bind a created video to an idempotency key. Returns false when a concurrent
 * request won the race — the caller must then treat the key as replayed
 * (serve the winner's video, discard this creation) rather than double-ingest.
 */
export async function recordIdempotentIngest(
  organizationId: string,
  idempotencyKey: string,
  videoId: string,
  endpoint: string = INGEST_IDEMPOTENCY_ENDPOINT,
): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .from('idempotency_keys')
      .insert({
        organization_id: organizationId,
        endpoint,
        idempotency_key: idempotencyKey,
        video_id: videoId,
      })

    if (!error) return true

    // Unique violation = concurrent duplicate request for the same key.
    if (error.code === '23505') return false
    console.error('Idempotency recording failed:', error)
    return false
  } catch (error) {
    console.error('Idempotency recording failed:', error)
    return false
  }
}
