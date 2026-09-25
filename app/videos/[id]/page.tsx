import { notFound } from 'next/navigation'
import { VideoInterface } from '@/components/video-interface'
import { VideoMetadata } from '@/components/video-metadata'
import { ApiKeyBanner } from '@/components/api-key-banner'
import { getVideoWithDetails } from '@/lib/supabase/database'
import { createVideoPlaybackUrl } from '@/lib/supabase/storage'
import { parseSeekSeconds } from '@/lib/evidence/permalink'

interface VideoPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ t?: string }>
}

export default async function VideoPage({ params, searchParams }: VideoPageProps) {
  const { id } = await params
  const { t } = await searchParams

  // Deep link: /videos/{id}?t=612.4 opens the review at the cited second.
  const initialTime = parseSeekSeconds(t)

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
        <VideoMetadata video={video} />
        <div className="mt-8">
          <VideoInterface
            video={video}
            playbackUrl={playbackUrl}
            initialTime={initialTime}
          />
        </div>
      </div>
    </div>
  )
}
