import { NextRequest, NextResponse } from 'next/server'
import { createVideoRecord } from '@/lib/supabase/database'
import { extractVideoId, isValidYouTubeUrl, getVideoInfo } from '@/lib/video/youtube'
import { env } from '@/app/config/env'
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, title: customTitle, description: customDescription } = body

    // Validation
    if (!url?.trim()) {
      return NextResponse.json(
        { error: 'YouTube URL is required' },
        { status: 400 }
      )
    }

    if (!isValidYouTubeUrl(url)) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      )
    }

    const videoId = extractVideoId(url)
    if (!videoId) {
      return NextResponse.json(
        { error: 'Could not extract video ID from URL' },
        { status: 400 }
      )
    }

    // Get video information from YouTube
    const videoInfo = await getVideoInfo(videoId)
    if (!videoInfo) {
      return NextResponse.json(
        { error: 'Could not fetch video information. Video may be private or unavailable.' },
        { status: 404 }
      )
    }

    // Check video duration (optional limit)
    const maxDuration = parseInt(env.MAX_VIDEO_DURATION_MINUTES || '30') * 60
    if (videoInfo.duration > maxDuration) {
      return NextResponse.json(
        { error: `Video duration (${Math.round(videoInfo.duration / 60)} minutes) exceeds maximum allowed (${maxDuration / 60} minutes)` },
        { status: 400 }
      )
    }

    // Create video record in database
    const { data: videoRecord, error: dbError } = await createVideoRecord({
      title: customTitle?.trim() || videoInfo.title,
      description: customDescription?.trim() || videoInfo.description,
      source_type: 'youtube',
      source_url: url,
      thumbnail_url: videoInfo.thumbnailUrl,
      duration_seconds: videoInfo.duration,
      metadata: {
        videoId,
        channelTitle: videoInfo.channelTitle,
        extractedAt: new Date().toISOString(),
        originalTitle: videoInfo.title,
        originalDescription: videoInfo.description
      }
    })

    if (dbError || !videoRecord) {
      return NextResponse.json(
        { error: `Database error: ${dbError}` },
        { status: 500 }
      )
    }

    // Start background processing
    processYouTubeVideoInBackground(videoRecord.id, videoId)

    return NextResponse.json({
      success: true,
      video: {
        id: videoRecord.id,
        title: videoRecord.title,
        description: videoRecord.description,
        status: videoRecord.processing_status,
        thumbnailUrl: videoRecord.thumbnail_url,
        duration: videoRecord.duration_seconds,
        youtubeId: videoId,
        channelTitle: videoInfo.channelTitle
      }
    })

  } catch (error) {
    console.error('YouTube extraction API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Background processing function for YouTube videos
async function processYouTubeVideoInBackground(videoId: string, youtubeId: string) {
  try {
    // Import processing functions
    const { processYouTubeVideo } = await import('@/lib/video/processing')
    
    // Trigger processing pipeline
    await processYouTubeVideo(videoId, youtubeId)
  } catch (error) {
    console.error('Background YouTube processing error:', error)
    
    // Update video status to failed
    const { updateVideoStatus } = await import('@/lib/supabase/database')
    await updateVideoStatus(
      videoId, 
      'failed', 
      error instanceof Error ? error.message : 'YouTube processing failed'
    )
  }
} 