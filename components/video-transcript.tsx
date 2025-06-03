'use client'

import { Transcript, TranscriptSegment, VideoChunk } from '@/lib/supabase/database'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Clock, FileText, Scissors } from 'lucide-react'
import { formatDuration } from '@/lib/video/youtube'
import { Button } from '@/components/ui/button'

interface VideoTranscriptProps {
  transcript?: Transcript
  segments?: TranscriptSegment[]
  chunks?: VideoChunk[]
  onTimeClick?: (time: number) => void
}

export function VideoTranscript({ transcript, segments = [], chunks = [], onTimeClick }: VideoTranscriptProps) {
  if (!transcript && segments.length === 0 && chunks.length === 0) {
    return (
      <div className="p-8 text-center border-2 border-dashed border-muted-foreground/25 rounded-lg">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium mb-2">No Transcript Available</h3>
        <p className="text-sm text-muted-foreground">
          This video doesn't have a transcript yet, or processing is still in progress.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">Transcript & Chunks</h2>
        <Badge variant="outline">
          {segments.length} segments
        </Badge>
        <Badge variant="outline">
          {chunks.length} chunks
        </Badge>
      </div>

      <Tabs defaultValue="segments" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="segments" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Transcript Segments
          </TabsTrigger>
          <TabsTrigger value="chunks" className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            Video Chunks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="segments" className="space-y-2">
          {segments.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className="p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => onTimeClick?.(segment.start_time_seconds)}
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      <span>
                        {formatDuration(segment.start_time_seconds)} - {formatDuration(segment.end_time_seconds)}
                      </span>
                    </Button>
                    {segment.confidence_score && (
                      <Badge variant="outline" className="text-xs">
                        {Math.round(segment.confidence_score * 100)}% confidence
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed">{segment.text_content}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No transcript segments available</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="chunks" className="space-y-3">
          {chunks.length > 0 ? (
            <div className="space-y-3">
              {chunks.map((chunk, index) => (
                <div
                  key={chunk.id}
                  className="p-4 border rounded-lg hover:bg-muted/25 transition-colors"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium">
                      {chunk.title || `Chunk ${index + 1}`}
                    </h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => onTimeClick?.(chunk.start_time_seconds)}
                    >
                      <Clock className="h-3 w-3 mr-1" />
                      <span>
                        {formatDuration(chunk.start_time_seconds)} - {formatDuration(chunk.end_time_seconds)}
                      </span>
                    </Button>
                  </div>
                  
                  {chunk.description && (
                    <p className="text-sm text-muted-foreground mb-3">
                      {chunk.description}
                    </p>
                  )}

                  {chunk.topics && chunk.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {chunk.topics.map((topic, topicIndex) => (
                        <Badge key={topicIndex} variant="secondary" className="text-xs">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {chunk.transcript_text && (
                    <div className="text-sm leading-relaxed bg-muted/30 p-3 rounded">
                      <p className="line-clamp-3">
                        {chunk.transcript_text.length > 200 
                          ? `${chunk.transcript_text.slice(0, 200)}...`
                          : chunk.transcript_text
                        }
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Scissors className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No video chunks available</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
} 