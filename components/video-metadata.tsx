'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { Badge } from '@/components/ui/badge'
import { Clock, Calendar, User, Video } from 'lucide-react'
import { formatDuration } from '@/lib/video/youtube'

interface VideoMetadataProps {
  video: VideoWithDetails
}

export function VideoMetadata({ video }: VideoMetadataProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800'
      case 'processing': return 'bg-blue-100 text-blue-800'
      case 'failed': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-4">
      {/* Title and Status */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold leading-tight">{video.title}</h1>
        <Badge className={getStatusColor(video.processing_status)}>
          {video.processing_status}
        </Badge>
      </div>

      {/* Video Details */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        {video.duration_seconds && (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>{formatDuration(video.duration_seconds)}</span>
          </div>
        )}
        
        <div className="flex items-center gap-1">
          <Video className="h-4 w-4" />
          <span className="capitalize">{video.source_type}</span>
        </div>

        {typeof video.metadata?.channelTitle === 'string' && (
          <div className="flex items-center gap-1">
            <User className="h-4 w-4" />
            <span>{video.metadata.channelTitle}</span>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>{new Date(video.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Description */}
      {video.description && (
        <div className="prose prose-sm max-w-none">
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {video.description.length > 500 
              ? `${video.description.slice(0, 500)}...` 
              : video.description
            }
          </p>
        </div>
      )}

      {/* Processing Error */}
      {video.processing_error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 font-medium">Processing Error:</p>
          <p className="text-sm text-red-700">{video.processing_error}</p>
        </div>
      )}

      {/* Processing Stats */}
      {video.processing_status === 'completed' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="text-center">
            <p className="text-lg font-bold">{video.transcriptSegments?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Transcript Segments</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">{video.chunks?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Video Chunks</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">
              {video.transcript?.language || 'N/A'}
            </p>
            <p className="text-xs text-muted-foreground">Language</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold">
              {video.transcript?.confidence_score 
                ? `${Math.round(video.transcript.confidence_score * 100)}%`
                : 'N/A'
              }
            </p>
            <p className="text-xs text-muted-foreground">Confidence</p>
          </div>
        </div>
      )}
    </div>
  )
} 