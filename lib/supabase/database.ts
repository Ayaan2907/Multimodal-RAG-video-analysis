import { supabaseAdmin, getSupabaseAdmin } from './admin'

export interface VideoRecord {
  id: string
  title: string
  description?: string
  source_type: 'upload' | 'youtube'
  source_url?: string
  file_path?: string
  thumbnail_url?: string
  duration_seconds?: number
  file_size_bytes?: number
  processing_status: 'uploading' | 'processing' | 'chunking' | 'transcribing' | 'embedding' | 'completed' | 'failed'
  processing_error?: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Transcript {
  id: string
  video_id: string
  content: string
  language?: string
  confidence_score?: number
  source?: string
  created_at: string
  updated_at: string
}

export interface TranscriptSegment {
  id: string
  transcript_id: string
  video_id: string
  text_content: string
  start_time_seconds: number
  end_time_seconds: number
  confidence_score?: number
  speaker_id?: string
  created_at: string
  updated_at: string
}

export interface VideoChunk {
  id: string
  video_id: string
  title?: string
  description?: string
  start_time_seconds: number
  end_time_seconds: number
  visual_description?: string
  transcript_text?: string
  key_frames?: unknown[]
  topics?: string[]
  entities?: string[]
  created_at: string
}

export interface VideoWithDetails extends VideoRecord {
  transcript?: Transcript
  transcriptSegments?: TranscriptSegment[]
  chunks?: VideoChunk[]
}

export async function createVideoRecord(data: {
  title: string
  description?: string
  source_type: 'upload' | 'youtube'
  source_url?: string
  file_path?: string
  thumbnail_url?: string
  duration_seconds?: number
  file_size_bytes?: number
  organization_id?: string | null
  metadata?: Record<string, unknown>
}): Promise<{ data: VideoRecord | null; error: string | null }> {
  try {
    const { organization_id, ...rest } = data
    const { data: video, error } = await supabaseAdmin
      .from('videos')
      .insert([{
        ...rest,
        // Videos are organization-scoped when the calling API key belongs to
        // an org; null (legacy/anonymous) rows stay invisible to org filters.
        organization_id: organization_id ?? null,
        processing_status: 'uploading'
      }])
      .select()
      .single()

    if (error) {
      console.error('Database insert error:', error)
      return { data: null, error: error.message }
    }

    return { data: video, error: null }
  } catch (error) {
    console.error('Database insert exception:', error)
    return {
      data: null,
      error: error instanceof Error ? error.message : 'Database operation failed'
    }
  }
}

export async function updateVideoStatus(
  videoId: string,
  status: VideoRecord['processing_status'],
  error?: string
): Promise<boolean> {
  try {
    const updateData: Record<string, unknown> = { processing_status: status }
    if (error) {
      updateData.processing_error = error
    }

    const { error: updateError } = await supabaseAdmin
      .from('videos')
      .update(updateData)
      .eq('id', videoId)

    if (updateError) {
      console.error('Status update error:', updateError)
      return false
    }

    return true
  } catch (error) {
    console.error('Status update exception:', error)
    return false
  }
}

// organizationId, when provided, scopes the read to that org's videos (404 for
// foreign videos — existence is not disclosed across orgs).
export async function getVideoById(
  videoId: string,
  organizationId?: string
): Promise<VideoRecord | null> {
  try {
    let query = supabaseAdmin
      .from('videos')
      .select('*')
      .eq('id', videoId)

    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }

    const { data, error } = await query.single()

    if (error) {
      console.error('Video fetch error:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Video fetch exception:', error)
    return null
  }
}

export async function createTranscript(data: {
  video_id: string
  content: string
  language?: string
  confidence_score?: number
  source?: string
}): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data: transcript, error } = await supabaseAdmin
      .from('transcripts')
      .insert([data])
      .select('id')
      .single()

    if (error) {
      console.error('Transcript insert error:', error)
      return { id: null, error: error.message }
    }

    return { id: transcript.id, error: null }
  } catch (error) {
    console.error('Transcript insert exception:', error)
    return {
      id: null,
      error: error instanceof Error ? error.message : 'Database operation failed'
    }
  }
}

export async function createTranscriptSegments(segments: Array<{
  transcript_id: string
  video_id: string
  text_content: string
  start_time_seconds: number
  end_time_seconds: number
  confidence_score?: number
  speaker_id?: string
}>): Promise<boolean> {
  try {
    // Validate that we have a valid transcript_id before attempting insert
    if (!segments[0]?.transcript_id || !segments[0]?.video_id) {
      console.error('Missing required IDs for transcript segments:', {
        transcript_id: segments[0]?.transcript_id,
        video_id: segments[0]?.video_id
      })
      return false
    }

    const { error } = await supabaseAdmin
      .from('transcript_segments')
      .insert(segments)

    if (error) {
      console.error('Transcript segments insert error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Transcript segments insert exception:', error)
    return false
  }
}

export async function createVideoChunk(data: {
  video_id: string
  title?: string
  description?: string
  start_time_seconds: number
  end_time_seconds: number
  visual_description?: string
  transcript_text?: string
  key_frames?: unknown[]
  topics?: string[]
  entities?: string[]
}): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data: chunk, error } = await supabaseAdmin
      .from('video_chunks')
      .insert([data])
      .select('id')
      .single()

    if (error) {
      console.error('Video chunk insert error:', error)
      return { id: null, error: error.message }
    }

    return { id: chunk.id, error: null }
  } catch (error) {
    console.error('Video chunk insert exception:', error)
    return {
      id: null,
      error: error instanceof Error ? error.message : 'Database operation failed'
    }
  }
}

export async function createEmbedding(data: {
  video_id: string
  chunk_id?: string
  content_type: 'transcript' | 'visual' | 'multimodal'
  content_text: string
  embedding: number[]
  metadata?: Record<string, unknown>
}): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('embeddings')
      .insert([data])

    if (error) {
      console.error('Embedding insert error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Embedding insert exception:', error)
    return false
  }
}

// organizationId, when provided, scopes the read to that org's videos (404 for
// foreign videos — existence is not disclosed across orgs).
export async function getVideoWithDetails(
  videoId: string,
  organizationId?: string
): Promise<VideoWithDetails | null> {
  try {
    const supabase = getSupabaseAdmin()

    // Fetch video
    let videoQuery = supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)

    if (organizationId) {
      videoQuery = videoQuery.eq('organization_id', organizationId)
    }

    const { data: video, error: videoError } = await videoQuery.single()

    if (videoError || !video) {
      console.error('Error fetching video:', videoError)
      return null
    }

    // Fetch transcript
    const { data: transcript, error: transcriptError } = await supabase
      .from('transcripts')
      .select('*')
      .eq('video_id', videoId)
      .single()

    if (transcriptError && transcriptError.code !== 'PGRST116') {
      console.error('Error fetching transcript:', transcriptError)
    }

    // Fetch transcript segments if transcript exists
    let transcriptSegments: TranscriptSegment[] = []
    if (transcript) {
      const { data: segments, error: segmentsError } = await supabase
        .from('transcript_segments')
        .select('*')
        .eq('transcript_id', transcript.id)
        .order('start_time_seconds', { ascending: true })

      if (segmentsError) {
        console.error('Error fetching transcript segments:', segmentsError)
      } else {
        transcriptSegments = segments || []
      }
    }

    // Fetch video chunks
    const { data: chunks, error: chunksError } = await supabase
      .from('video_chunks')
      .select('*')
      .eq('video_id', videoId)
      .order('start_time_seconds', { ascending: true })

    if (chunksError) {
      console.error('Error fetching video chunks:', chunksError)
    }

    return {
      ...video,
      transcript: transcript || undefined,
      transcriptSegments,
      chunks: chunks || []
    }
  } catch (error) {
    console.error('Error in getVideoWithDetails:', error)
    return null
  }
}

export async function getTranscriptTextForChunk(
  videoId: string,
  startTimeSeconds: number,
  endTimeSeconds: number
): Promise<string> {
  try {
    const { data: segments, error } = await supabaseAdmin
      .from('transcript_segments')
      .select('text_content')
      .eq('video_id', videoId)
      .gte('start_time_seconds', startTimeSeconds)
      .lte('end_time_seconds', endTimeSeconds)
      .order('start_time_seconds')

    if (error) {
      console.error('Error fetching transcript segments for chunk:', error)
      return ''
    }

    return segments?.map((seg: { text_content: string }) => seg.text_content).join(' ') || ''
  } catch (error) {
    console.error('Error reconstructing transcript text for chunk:', error)
    return ''
  }
} 