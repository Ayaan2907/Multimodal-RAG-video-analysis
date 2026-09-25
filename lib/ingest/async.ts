import { promises as fs } from 'fs'
import { join } from 'path'
import { createVideoRecord } from '@/lib/supabase/database'
import { uploadVideoFile } from '@/lib/supabase/storage'
import { extractAudioFromVideoLocal, checkFFmpegAvailability } from '@/lib/video/audio-extraction'
import { extractVideoId, isValidYouTubeUrl, getVideoInfo } from '@/lib/video/youtube'
import { sha256Hex } from '@/lib/evidence/hash'
import { processUploadedVideo, processYouTubeVideo } from '@/lib/video/processing'

// Async ingest for POST /api/v1/ingest (spec art_HKWx4t5y §4).
// The route validates what it can cheaply (shape, URL, size, type, bytes
// hash), creates the org-scoped record, answers 202, and hands the expensive
// work (storage upload, ffmpeg, transcription, embeddings) to background
// starters. Status is polled via GET /api/v1/videos/{id}/status.

export const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
export const ALLOWED_FILE_TYPES = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm']

export type IngestValidationError = {
  code:
    | 'missing_file'
    | 'missing_title'
    | 'file_too_large'
    | 'unsupported_file_type'
    | 'missing_url'
    | 'invalid_url'
    | 'video_unavailable'
    | 'video_too_long'
    | 'ffmpeg_unavailable'
    | 'database_error'
  message: string
}

export type IngestResult =
  | { ok: true; videoId: string }
  | { ok: false; validation: IngestValidationError }

/** Pure file validation — checkable without reading the body. */
export function validateUploadFile(file: { size: number; type: string }): IngestValidationError | null {
  if (file.size > MAX_FILE_SIZE) {
    return {
      code: 'file_too_large',
      message: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`,
    }
  }
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return {
      code: 'unsupported_file_type',
      message: `File type ${file.type} not supported. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`,
    }
  }
  return null
}

export interface YoutubeIngestInput {
  organizationId: string
  url: string
  title?: string
  description?: string
}

export async function createYoutubeIngest(input: YoutubeIngestInput): Promise<IngestResult> {
  const url = input.url?.trim()
  if (!url) {
    return { ok: false, validation: { code: 'missing_url', message: 'YouTube URL is required' } }
  }
  if (!isValidYouTubeUrl(url)) {
    return { ok: false, validation: { code: 'invalid_url', message: 'Invalid YouTube URL' } }
  }
  const youtubeId = extractVideoId(url)
  if (!youtubeId) {
    return { ok: false, validation: { code: 'invalid_url', message: 'Could not extract video ID from URL' } }
  }

  // Metadata fetch stays on the request path: it doubles as availability
  // validation, and a 404 before the 202 is a better contract than a record
  // that immediately fails in the background.
  const videoInfo = await getVideoInfo(youtubeId)
  if (!videoInfo) {
    return {
      ok: false,
      validation: {
        code: 'video_unavailable',
        message: 'Could not fetch video information. Video may be private or unavailable.',
      },
    }
  }

  const maxDuration = Number.parseInt(process.env.MAX_VIDEO_DURATION_MINUTES || '30', 10) * 60
  if (videoInfo.duration > maxDuration) {
    return {
      ok: false,
      validation: {
        code: 'video_too_long',
        message: `Video duration (${Math.round(videoInfo.duration / 60)} minutes) exceeds maximum allowed (${maxDuration / 60} minutes)`,
      },
    }
  }

  const { data: videoRecord, error: dbError } = await createVideoRecord({
    title: input.title?.trim() || videoInfo.title,
    description: input.description?.trim() || videoInfo.description,
    source_type: 'youtube',
    source_url: url,
    thumbnail_url: videoInfo.thumbnailUrl,
    duration_seconds: videoInfo.duration,
    organization_id: input.organizationId,
    metadata: {
      videoId: youtubeId,
      channelTitle: videoInfo.channelTitle,
      extractedAt: new Date().toISOString(),
    },
  })

  if (dbError || !videoRecord) {
    return {
      ok: false,
      validation: { code: 'database_error', message: `Database error: ${dbError}` },
    }
  }

  startYoutubeProcessing(videoRecord.id, youtubeId)
  return { ok: true, videoId: videoRecord.id }
}

export interface UploadIngestInput {
  organizationId: string
  file: File
  title?: string
  description?: string
}

export async function createUploadIngest(input: UploadIngestInput): Promise<IngestResult> {
  const { file } = input
  if (!file) {
    return { ok: false, validation: { code: 'missing_file', message: 'No file provided' } }
  }
  if (!input.title?.trim()) {
    return { ok: false, validation: { code: 'missing_title', message: 'Title is required' } }
  }
  const validation = validateUploadFile({ size: file.size, type: file.type })
  if (validation) {
    return { ok: false, validation }
  }

  const ffmpegAvailable = await checkFFmpegAvailability()
  if (!ffmpegAvailable) {
    return {
      ok: false,
      validation: {
        code: 'ffmpeg_unavailable',
        message: 'FFmpeg not available. Please install FFmpeg to process uploaded videos.',
      },
    }
  }

  // Accept the bytes: persist to scratch and hash them on the request path —
  // the chain-of-custody hash must cover exactly what the caller sent.
  const tempDir = process.env.TEMP_DIR || '/tmp'
  const tempVideoPath = join(tempDir, `ingest_${Date.now()}_${Math.random().toString(36).slice(2)}.${file.name.split('.').pop()}`)
  const buffer = Buffer.from(await file.arrayBuffer())
  const contentSha256 = sha256Hex(buffer)
  await fs.writeFile(tempVideoPath, buffer)

  const { data: videoRecord, error: dbError } = await createVideoRecord({
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    source_type: 'upload',
    source_url: file.name,
    file_size_bytes: file.size,
    organization_id: input.organizationId,
    content_sha256: contentSha256,
    content_hash_scope: 'file',
    metadata: {
      originalFileName: file.name,
      mimeType: file.type,
      uploadedAt: new Date().toISOString(),
    },
  })

  if (dbError || !videoRecord) {
    await cleanupTempFile(tempVideoPath)
    return {
      ok: false,
      validation: { code: 'database_error', message: `Database error: ${dbError}` },
    }
  }

  startUploadProcessing({
    videoId: videoRecord.id,
    buffer,
    fileName: file.name,
    mimeType: file.type,
    tempVideoPath,
  })
  return { ok: true, videoId: videoRecord.id }
}

/**
 * Background: storage upload → audio extraction → full pipeline. Runs after
 * the 202 has been sent; failures land in the video's status, never in a
 * caller's hands.
 */
async function startUploadProcessing(input: {
  videoId: string
  buffer: Buffer
  fileName: string
  mimeType: string
  tempVideoPath: string
}): Promise<void> {
  const { videoId, buffer, fileName, mimeType, tempVideoPath } = input
  let audioPath: string | null = null
  try {
    const file = new File([buffer], fileName, { type: mimeType })
    const uploadResult = await uploadVideoFile(file, fileName)
    if (uploadResult.error) {
      await markFailed(videoId, `Storage upload failed: ${uploadResult.error}`)
      return
    }
    await recordFilePath(videoId, uploadResult.path)

    const audioResult = await extractAudioFromVideoLocal(tempVideoPath, videoId)
    audioPath = audioResult.audioPath
    await processUploadedVideo(videoId, audioPath)
  } catch (error) {
    console.error(`Background ingest processing error for video ${videoId}:`, error)
    await markFailed(videoId, error instanceof Error ? error.message : 'Processing failed')
  } finally {
    await cleanupTempFile(tempVideoPath)
    if (audioPath) {
      await cleanupTempFile(audioPath)
    }
  }
}

function startYoutubeProcessing(videoId: string, youtubeId: string): void {
  void (async () => {
    try {
      await processYouTubeVideo(videoId, youtubeId)
    } catch (error) {
      console.error(`Background YouTube processing error for video ${videoId}:`, error)
      await markFailed(videoId, error instanceof Error ? error.message : 'YouTube processing failed')
    }
  })()
}

async function markFailed(videoId: string, message: string): Promise<void> {
  const { updateVideoStatus } = await import('@/lib/supabase/database')
  await updateVideoStatus(videoId, 'failed', message)
}

async function recordFilePath(videoId: string, filePath: string): Promise<void> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const { error } = await getSupabaseAdmin().from('videos').update({ file_path: filePath }).eq('id', videoId)
  if (error) {
    console.error(`Failed to record storage path for video ${videoId}:`, error)
  }
}

async function cleanupTempFile(path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch (error) {
    console.warn(`Failed to clean up temp file ${path}:`, error)
  }
}
