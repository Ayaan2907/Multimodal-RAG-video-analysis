'use client'

import { VideoWithDetails } from '@/lib/supabase/database'

interface VideoPlayerProps {
  video: VideoWithDetails
}

export function VideoPlayer({ video }: VideoPlayerProps) {
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
        <video
          controls
          className="w-full h-full"
          poster={video.thumbnail_url}
        >
          <source src={video.file_path} type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full bg-muted rounded-lg flex items-center justify-center">
      <p className="text-muted-foreground">Video not available</p>
    </div>
  )
} 