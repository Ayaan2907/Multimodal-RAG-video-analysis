'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { VideoPlayer, VideoPlayerRef } from './video-player'
import { VideoTranscript } from './video-transcript'
import { ChatInterface } from './chat-interface'
import { buildPermalink } from '@/lib/evidence/permalink'
import { useCallback, useEffect, useRef } from 'react'

interface VideoInterfaceProps {
  video: VideoWithDetails
  /** Short-lived signed playback URL, resolved server-side (private buckets). */
  playbackUrl?: string | null
  /** Deep-linked seek target in seconds (?t=612.4), applied once media is ready. */
  initialTime?: number | null
}

export function VideoInterface({ video, playbackUrl, initialTime }: VideoInterfaceProps) {
  const playerRef = useRef<VideoPlayerRef>(null)
  const initialSeekApplied = useRef(false)

  // Deep link: /videos/{id}?t=612.4 opens the review at the cited second.
  useEffect(() => {
    if (initialTime == null || initialSeekApplied.current) return
    initialSeekApplied.current = true
    playerRef.current?.seekTo(initialTime)
  }, [initialTime])

  // Every timestamp and citation seeks the player and restores the permalink
  // in the address bar; citations additionally copy the link (spec §2).
  const handleEvidenceClick = useCallback(
    (time: number, options: { copy?: boolean } = {}) => {
      playerRef.current?.seekTo(time)

      const permalink = buildPermalink(window.location.origin, video.id, time)
      window.history.replaceState(null, '', permalink)

      if (options.copy) {
        navigator.clipboard?.writeText(permalink).catch(() => {
          // Clipboard denial is non-fatal — the seek and permalink still land.
          console.warn('Permalink copy failed: clipboard unavailable')
        })
      }
    },
    [video.id],
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-6">
        <VideoPlayer
          ref={playerRef}
          video={video}
          playbackUrl={playbackUrl}
          initialTime={initialTime}
        />
        <VideoTranscript
          transcript={video.transcript}
          segments={video.transcriptSegments}
          chunks={video.chunks}
          onTimeClick={(time) => handleEvidenceClick(time)}
        />
      </div>
      <div className="md:col-span-1">
        <ChatInterface
          video={video}
          onSourceClick={(time) => handleEvidenceClick(time, { copy: true })}
        />
      </div>
    </div>
  )
}
