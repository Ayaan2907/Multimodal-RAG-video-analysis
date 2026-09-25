import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/video-player'
import { VideoTranscript } from '@/components/video-transcript'
import { VideoMetadata } from '@/components/video-metadata'
import { ChatInterface } from '@/components/chat-interface'
import { ApiKeyBanner } from '@/components/api-key-banner'
import { getVideoWithDetails } from '@/lib/supabase/database'
import { createVideoPlaybackUrl } from '@/lib/supabase/storage'

interface VideoPageProps {
  params: Promise<{ id: string }>
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { id } = await params
  
  // Fetch video with all related data
  const video = await getVideoWithDetails(id)
  
  if (!video) {
    notFound()
  }

  // Playback URLs are minted server-side (short-lived signed URL) — the
  // browser never sees a public bucket URL and the client never needs
  // storage credentials.
  const playbackUrl = video.file_path
    ? await createVideoPlaybackUrl(video.file_path)
    : null

  return (
    <div className="min-h-screen bg-background">
      <ApiKeyBanner />
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Video and Metadata */}
          <div className="lg:col-span-2 space-y-6">
            {/* Video Player */}
            <VideoPlayer video={video} playbackUrl={playbackUrl} />
            
            {/* Video Metadata */}
            <VideoMetadata video={video} />
            
            {/* Transcript */}
            <VideoTranscript 
              transcript={video.transcript}
              segments={video.transcriptSegments}
              chunks={video.chunks}
            />
          </div>
          
          {/* Right Column - Chat Interface */}
          <div className="lg:col-span-1">
            <ChatInterface video={video} />
          </div>
        </div>
      </div>
    </div>
  )
}