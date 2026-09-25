import type { VideoRecord } from '@/lib/supabase/database'

// Contracts shared by the /api/v1 surface (spec art_HKWx4t5y §4).
// The processing status enum mirrors videos.processing_status — the state
// machine the pipeline walks: uploading → processing → transcribing/chunking
// → embedding → completed | failed.

export const PROCESSING_STATUSES = [
  'uploading',
  'processing',
  'chunking',
  'transcribing',
  'embedding',
  'completed',
  'failed',
] as const

export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number]

export function isProcessingStatus(value: string): value is ProcessingStatus {
  return (PROCESSING_STATUSES as readonly string[]).includes(value)
}

/** Ingest polling progress, derived from the status alone. */
export function progressForStatus(status: ProcessingStatus): number {
  const progressMap: Record<ProcessingStatus, number> = {
    uploading: 10,
    processing: 25,
    transcribing: 60,
    chunking: 50,
    embedding: 80,
    completed: 100,
    failed: 0,
  }
  return progressMap[status]
}

export interface VideoStatusResponse {
  id: string
  status: ProcessingStatus
  progress: number
  error?: string
}

export function buildStatusResponse(video: Pick<VideoRecord, 'id' | 'processing_status' | 'processing_error'>): VideoStatusResponse | null {
  if (!isProcessingStatus(video.processing_status)) return null
  return {
    id: video.id,
    status: video.processing_status,
    progress: progressForStatus(video.processing_status),
    ...(video.processing_error ? { error: video.processing_error } : {}),
  }
}

export interface IngestAcceptedResponse {
  id: string
  status: 'queued'
  status_url: string
}

export function buildIngestAcceptedResponse(videoId: string): IngestAcceptedResponse {
  return {
    id: videoId,
    status: 'queued',
    status_url: `/api/v1/videos/${videoId}/status`,
  }
}
