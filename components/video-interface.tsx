'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { VideoPlayer, VideoPlayerRef } from './video-player'
import { VideoTranscript } from './video-transcript'
import { ChatInterface } from './chat-interface'
import { useRef } from 'react'

interface VideoInterfaceProps {
  video: VideoWithDetails
}

export function VideoInterface({ video }: VideoInterfaceProps) {
  const playerRef = useRef<VideoPlayerRef>(null)

  const handleTimeClick = (time: number) => {
    playerRef.current?.seekTo(time)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-6">
        <VideoPlayer 
          ref={playerRef}
          video={video} 
        />
        <VideoTranscript 
          transcript={video.transcript}
          segments={video.transcriptSegments}
          chunks={video.chunks}
          onTimeClick={handleTimeClick}
        />
      </div>
      <div className="md:col-span-1">
        <ChatInterface 
          video={video}
          onSourceClick={handleTimeClick}
        />
      </div>
    </div>
  )
} 