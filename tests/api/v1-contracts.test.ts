import { describe, expect, it } from 'vitest'
import type { VideoRecord } from '@/lib/supabase/database'
import {
  buildIngestAcceptedResponse,
  buildStatusResponse,
  PROCESSING_STATUSES,
} from '@/lib/api/v1-contracts'

// The v1 status contract (spec art_HKWx4t5y §4): status is a closed enum,
// progress is a percentage, failed carries the pipeline error, and the ingest
// 202 answers {id, status:'queued', status_url}.

type VideoRecordLike = Pick<VideoRecord, 'id' | 'processing_status' | 'processing_error'> & {
  duration_seconds?: number
}

function video(overrides: Partial<VideoRecordLike> = {}): VideoRecordLike {
  return {
    id: 'vid_1',
    processing_status: 'completed',
    duration_seconds: 120,
    ...overrides,
  }
}

describe('PROCESSING_STATUSES', () => {
  it('is exactly the migration enum', () => {
    expect(PROCESSING_STATUSES).toEqual([
      'uploading',
      'processing',
      'chunking',
      'transcribing',
      'embedding',
      'completed',
      'failed',
    ])
  })
})

describe('buildStatusResponse', () => {
  it('maps completed to 100% progress with no error field', () => {
    expect(buildStatusResponse(video())).toEqual({
      id: 'vid_1',
      status: 'completed',
      progress: 100,
    })
  })

  it('carries the pipeline error on failed', () => {
    const response = buildStatusResponse(video({ processing_status: 'failed', processing_error: 'ffmpeg died' }))
    expect(response).toEqual({
      id: 'vid_1',
      status: 'failed',
      progress: 0,
      error: 'ffmpeg died',
    })
  })

  it('maps in-flight states to increasing, sub-100 progress', () => {
    const mapping: Array<[VideoRecordLike['processing_status'], number]> = [
      ['uploading', 10],
      ['processing', 25],
      ['chunking', 50],
      ['transcribing', 60],
      ['embedding', 80],
    ]
    let previous = 0
    for (const [status, expectedProgress] of mapping) {
      const response = buildStatusResponse(video({ processing_status: status }))
      expect(response?.progress).toBe(expectedProgress)
      expect(response?.progress).toBeGreaterThan(previous)
      expect(response?.progress).toBeLessThan(100)
      previous = expectedProgress
    }
  })

  it('returns null for a status outside the contract (no fabricated status)', () => {
    expect(buildStatusResponse(video({ processing_status: 'weird' as never }))).toBeNull()
  })
})

describe('buildIngestAcceptedResponse', () => {
  it('is the 202 queued shape with a status_url the client can poll', () => {
    expect(buildIngestAcceptedResponse('vid_42')).toEqual({
      id: 'vid_42',
      status: 'queued',
      status_url: '/api/v1/videos/vid_42/status',
    })
  })
})
