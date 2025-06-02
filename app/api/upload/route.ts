import { NextRequest, NextResponse } from 'next/server'
import { uploadVideoFile } from '@/lib/supabase/storage'
import { createVideoRecord } from '@/lib/supabase/database'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const ALLOWED_TYPES = ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm']

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const title = formData.get('title') as string
    const description = formData.get('description') as string

    // Validation
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!title?.trim()) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit` },
        { status: 400 }
      )
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type ${file.type} not supported. Allowed types: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Upload file to Supabase storage
    const uploadResult = await uploadVideoFile(file, file.name)
    
    if (uploadResult.error) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadResult.error}` },
        { status: 500 }
      )
    }

    // Create video record in database
    const { data: videoRecord, error: dbError } = await createVideoRecord({
      title: title.trim(),
      description: description?.trim() || undefined,
      source_type: 'upload',
      source_url: file.name,
      file_path: uploadResult.path,
      file_size_bytes: file.size,
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
      
      return NextResponse.json(
        { error: `Database error: ${dbError}` },
        { status: 500 }
      )
    }

    // Start background processing
    // Note: In production, you'd trigger this via a queue or webhook
    processVideoInBackground(videoRecord.id)

    return NextResponse.json({
      success: true,
      video: {
        id: videoRecord.id,
        title: videoRecord.title,
        description: videoRecord.description,
        status: videoRecord.processing_status,
        fileUrl: uploadResult.publicUrl
      }
    })

  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Background processing function
async function processVideoInBackground(videoId: string) {
  try {
    // Import processing functions
    const { processUploadedVideo } = await import('@/lib/video/processing')
    
    // Trigger processing pipeline
    await processUploadedVideo(videoId)
  } catch (error) {
    console.error('Background processing error:', error)
    
    // Update video status to failed
    const { updateVideoStatus } = await import('@/lib/supabase/database')
    await updateVideoStatus(
      videoId, 
      'failed', 
      error instanceof Error ? error.message : 'Processing failed'
    )
  }
} 