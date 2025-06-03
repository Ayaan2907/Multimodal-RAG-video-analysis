'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { useRef, useImperativeHandle, forwardRef, useState, useEffect } from 'react'
import { getVideoFileUrl } from '@/lib/supabase/storage'
import { MediaController, MediaControlBar, MediaTimeDisplay, MediaTimeRange, MediaPlayButton, MediaMuteButton, MediaVolumeRange, MediaSeekBackwardButton, MediaSeekForwardButton, MediaFullscreenButton } from 'media-chrome/dist/react'

interface VideoPlayerProps {
  video: VideoWithDetails
  onTimeUpdate?: (time: number) => void
}

export interface VideoPlayerRef {
  seekTo: (time: number) => void
}

export const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({ video, onTimeUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (video.source_type === 'upload' && video.file_path) {
      getVideoFileUrl(video.file_path).then(url => {
        console.log('Video URL:', url)
        setVideoUrl(url)
      }).catch(err => {
        console.error('Error getting video URL:', err)
        setError('Error loading video URL')
      })
    }
  }, [video.source_type, video.file_path])

  useImperativeHandle(ref, () => ({
    seekTo: (time: number) => {
      if (videoRef.current) {
        videoRef.current.currentTime = time
      }
    }
  }))

  if (video.source_type === 'youtube' && video.source_url) {
    // Extract YouTube video ID
    const urlParams = new URLSearchParams(new URL(video.source_url).search)
    const videoId = urlParams.get('v') || video.source_url.split('/').pop()

    return (
      <div className="aspect-video w-full bg-black rounded-lg overflow-hidden">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}`}
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