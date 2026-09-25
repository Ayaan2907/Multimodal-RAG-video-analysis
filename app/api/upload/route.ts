import { NextRequest, NextResponse } from 'next/server'
import { uploadVideoFile } from '@/lib/supabase/storage'
import { createVideoRecord } from '@/lib/supabase/database'
import { extractAudioFromVideoLocal, checkFFmpegAvailability } from '@/lib/video/audio-extraction'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { promises as fs } from 'fs'
import { join } from 'path'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const ALLOWED_TYPES = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm']

export async function POST(request: NextRequest) {
  let tempVideoPath: string | null = null

  try {
    // Auth first — unauthenticated requests never touch formData or storage.
    const auth = await authenticateRequest(request, 'ingest:write')
    if (!auth.ok) return authErrorResponse(auth)

    const formData = await request.formData()
    const file = formData.get('file') as File
    const title = formData.get('title') as string
    const description = formData.get('description') as string

    // Validation
    if (!file) {
      return jsonError(400, 'missing_file', 'No file provided')
    }

    if (!title?.trim()) {
      return jsonError(400, 'missing_title', 'Title is required')
    }

    if (file.size > MAX_FILE_SIZE) {
      return jsonError(400, 'file_too_large', `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit`)
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return jsonError(400, 'unsupported_file_type', `File type ${file.type} not supported. Allowed types: ${ALLOWED_TYPES.join(', ')}`)
    }

    // Check if FFmpeg is available
    const ffmpegAvailable = await checkFFmpegAvailability()
    if (!ffmpegAvailable) {
      return jsonError(500, 'ffmpeg_unavailable', 'FFmpeg not available. Please install FFmpeg to process uploaded videos.')
    }

    // Save video to temporary location and extract audio
    const tempDir = process.env.TEMP_DIR || '/tmp'
    const tempFileName = `temp_${Date.now()}_${Math.random().toString(36).substring(2)}.${file.name.split('.').pop()}`
    tempVideoPath = join(tempDir, tempFileName)

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    await fs.writeFile(tempVideoPath, buffer)

    // Extract audio to local file only (no upload, no cleanup)
    const audioResult = await extractAudioFromVideoLocal(tempVideoPath, 'temp')

    // Upload only the video file to Supabase storage
    const uploadResult = await uploadVideoFile(file, file.name)

    if (uploadResult.error) {
      return jsonError(500, 'upload_failed', `Upload failed: ${uploadResult.error}`)
    }

    // Create video record in database (org-scoped to the key's organization)
    const { data: videoRecord, error: dbError } = await createVideoRecord({
      title: title.trim(),
      description: description?.trim() || undefined,
      source_type: 'upload',
      source_url: file.name,
      file_path: uploadResult.path,
      file_size_bytes: file.size,
      organization_id: auth.context.organizationId,
      metadata: {
        originalFileName: file.name,
        mimeType: file.type,
        uploadedAt: new Date().toISOString()
      }
    })

    if (dbError || !videoRecord) {
      // Clean up uploaded file if database operation failed
      await import('@/lib/supabase/storage').then(({ deleteVideoFile }) =>
        deleteVideoFile(uploadResult.path)
      )

      return jsonError(500, 'database_error', `Database error: ${dbError}`)
    }

    // Start background processing with audio file path
    processVideoInBackground(videoRecord.id, audioResult.audioPath)

    return NextResponse.json({
      success: true,
      video: {
        id: videoRecord.id,
        title: videoRecord.title,
        description: videoRecord.description,
        status: videoRecord.processing_status,
        fileUrl: uploadResult.fileUrl
      }
    })

  } catch (error) {
    console.error('Upload API error:', error)

    return jsonError(500, 'internal_error', 'Internal server error')
  } finally {
    // Always cleanup temp video file (but NOT audio file - background processing needs it)
    if (tempVideoPath) {
      try {
        await fs.unlink(tempVideoPath)
      } catch (cleanupError) {
        console.warn('Failed to cleanup temp video file:', cleanupError)
      }
    }

    // NOTE: audioPath is NOT cleaned up here - background processing will handle it
  }
}

// Background processing function
async function processVideoInBackground(videoId: string, audioFilePath: string) {
  try {
    // Import processing functions
    const { processUploadedVideo } = await import('@/lib/video/processing')

    // Trigger processing pipeline with audio file path
    await processUploadedVideo(videoId, audioFilePath)
  } catch (error) {
    console.error('Background processing error:', error)

    // Update video status to failed
    const { updateVideoStatus } = await import('@/lib/supabase/database')
    await updateVideoStatus(
      videoId,
      'failed',
      error instanceof Error ? error.message : 'Processing failed'
    )
  } finally {
    // Always cleanup audio file after processing (success or failure)
    try {
      await fs.unlink(audioFilePath)
    } catch (cleanupError) {
      console.warn(`Failed to cleanup temp audio file ${audioFilePath}:`, cleanupError)
    }
  }
}
