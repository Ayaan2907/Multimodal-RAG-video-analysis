import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/video-player'
import { VideoTranscript } from '@/components/video-transcript'
import { VideoMetadata } from '@/components/video-metadata'
import { ChatInterface } from '@/components/chat-interface'
import { getVideoWithDetails } from '@/lib/supabase/database'

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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Video and Metadata */}
          <div className="lg:col-span-2 space-y-6">
            {/* Video Player */}
            <VideoPlayer video={video} />
            
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