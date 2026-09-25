'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { useRef, useImperativeHandle, forwardRef, useState } from 'react'

interface VideoPlayerProps {
  video: VideoWithDetails
  /** Short-lived signed playback URL, resolved server-side (private buckets). */
  playbackUrl?: string | null
  /** Deep-linked seek target in seconds (?t=612.4), applied once media is ready. */
  initialTime?: number | null
  onTimeUpdate?: (time: number) => void
}

export interface VideoPlayerRef {
  seekTo: (time: number) => void
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({ video, playbackUrl, initialTime, onTimeUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const videoUrl = playbackUrl ?? null
  // Seeks before metadata loads throw (readyState 0) — queue until ready.
  const pendingSeekRef = useRef<number | null>(initialTime ?? null)

  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      const element = videoRef.current
      if (element && element.readyState >= 1) {
        element.currentTime = time
      } else {
        pendingSeekRef.current = time
      }
    }
  }))

  if (video.source_type === 'youtube' && video.source_url) {
    // Extract YouTube video ID
    const urlParams = new URLSearchParams(new URL(video.source_url).search)
    const videoId = urlParams.get('v') || video.source_url.split('/').pop()

    // Deep links seek YouTube embeds via the native start parameter.
    const startParam = initialTime != null ? `?start=${Math.floor(initialTime)}` : ''

    return (
      <div className="aspect-video w-full bg-black rounded-lg overflow-hidden">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}${startParam}`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="w-full h-full"
        />
      </div>
    )
  }

  if (video.source_type === 'upload' && video.file_path) {
    return (
      <div className="aspect-video w-full bg-black rounded-lg overflow-hidden">
        <div className="relative w-full h-full">
          {videoUrl ? (
            <video
              ref={videoRef}
              className="w-full h-full"
              poster={video.thumbnail_url}
              preload="auto"
              playsInline
              controls
              onError={(e) => {
                console.error('Video error:', e)
                const videoElement = e.currentTarget as HTMLVideoElement
                setError(videoElement.error?.message || 'Error loading video')
              }}
              onLoadedData={() => {
                console.log('Video loaded successfully')
                setError(null)
                // Apply a queued deep-link/citation seek once media is ready.
                if (pendingSeekRef.current != null && videoRef.current) {
                  videoRef.current.currentTime = pendingSeekRef.current
                  pendingSeekRef.current = null
                }
              }}
              onTimeUpdate={() => {
                if (videoRef.current && onTimeUpdate) {
                  onTimeUpdate(videoRef.current.currentTime)
                }
              }}
            >
              <source 
                src={videoUrl}
                type="video/mp4"
                onError={(e) => console.error('Source error:', e)} 
              />
              Your browser does not support the video tag.
            </video>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm p-4 text-center">
              {error}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full bg-muted rounded-lg flex items-center justify-center">
      <p className="text-muted-foreground">Video not available</p>
    </div>
  )
})

VideoPlayer.displayName = 'VideoPlayer'
