import { describe, expect, it } from 'vitest'
import type { TranscriptSegment, VideoChunk } from '@/lib/supabase/database'
import {
  buildExportEntries,
  buildTranscriptExport,
  formatClockTimestamp,
  formatSrtTimestamp,
  formatVttTimestamp,
  isTranscriptExportFormat,
} from '@/lib/export/transcript'

// Golden-file proof: rendered SRT/VTT timestamps must equal the stored chunk
// offsets exactly — second-level evidence cannot drift from what was chunked
// (spec art_HKWx4t5y acceptance: "SRT/VTT timestamps equal chunk offsets").

function chunk(overrides: Partial<VideoChunk> & Pick<VideoChunk, 'id' | 'start_time_seconds' | 'end_time_seconds'>): VideoChunk {
  return {
    video_id: 'vid-1',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const fixtureChunks: VideoChunk[] = [
  chunk({ id: 'chunk-1', title: 'Arrival', start_time_seconds: 0, end_time_seconds: 30.5, transcript_text: 'Officer arrives on scene.' }),
  chunk({ id: 'chunk-2', title: 'Witness statement', start_time_seconds: 612.4, end_time_seconds: 672.4, transcript_text: 'The witness states the door was open.' }),
  chunk({ id: 'chunk-3', title: 'Custody', start_time_seconds: 730.75, end_time_seconds: 790, transcript_text: 'Chain of custody begins here.' }),
]

const fixtureVideo = {
  id: 'vid-1',
  title: 'Interview Tape 4',
  source_type: 'upload' as const,
  source_url: 'interview-4.mp4',
  duration_seconds: 790,
}

describe('timestamp formatting', () => {
  it('formats SRT cues with comma milliseconds', () => {
    expect(formatSrtTimestamp(612.4)).toBe('00:10:12,400')
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000')
    expect(formatSrtTimestamp(790)).toBe('00:13:10,000')
    expect(formatSrtTimestamp(3661.5)).toBe('01:01:01,500')
  })

  it('formats VTT cues with dot milliseconds', () => {
    expect(formatVttTimestamp(612.4)).toBe('00:10:12.400')
    expect(formatVttTimestamp(3661.5)).toBe('01:01:01.500')
  })

  it('formats human clock timestamps', () => {
    expect(formatClockTimestamp(612.4)).toBe('10:12')
    expect(formatClockTimestamp(0)).toBe('00:00')
    expect(formatClockTimestamp(3661.5)).toBe('1:01:01')
  })
})

describe('golden SRT export', () => {
  const expected = [
    '1',
    '00:00:00,000 --> 00:00:30,500',
    'Officer arrives on scene.',
    '',
    '2',
    '00:10:12,400 --> 00:11:12,400',
    'The witness states the door was open.',
    '',
    '3',
    '00:12:10,750 --> 00:13:10,000',
    'Chain of custody begins here.',
    '',
  ].join('\n')

  it('matches the golden string byte-for-byte', () => {
    expect(buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'srt')).toBe(expected)
  })

  it('cue timestamps equal the chunk offsets', () => {
    const srt = buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'srt')
    for (const chunk of fixtureChunks) {
      expect(srt).toContain(`${formatSrtTimestamp(chunk.start_time_seconds)} --> ${formatSrtTimestamp(chunk.end_time_seconds)}`)
    }
  })
})

describe('golden VTT export', () => {
  const expected = [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:30.500',
    'Officer arrives on scene.',
    '',
    '00:10:12.400 --> 00:11:12.400',
    'The witness states the door was open.',
    '',
    '00:12:10.750 --> 00:13:10.000',
    'Chain of custody begins here.',
    '',
  ].join('\n')

  it('matches the golden string byte-for-byte', () => {
    expect(buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'vtt')).toBe(expected)
  })

  it('cue timestamps equal the chunk offsets', () => {
    const vtt = buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'vtt')
    for (const chunk of fixtureChunks) {
      expect(vtt).toContain(`${formatVttTimestamp(chunk.start_time_seconds)} --> ${formatVttTimestamp(chunk.end_time_seconds)}`)
    }
  })
})

describe('markdown export', () => {
  it('uses clock timestamps and chunk titles', () => {
    const md = buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'md')
    expect(md).toContain('# Transcript — Interview Tape 4')
    expect(md).toContain('## [00:00 - 00:30] Arrival')
    expect(md).toContain('## [10:12 - 11:12] Witness statement')
    expect(md).toContain('## [12:10 - 13:10] Custody')
    expect(md).toContain('The witness states the door was open.')
  })
})

describe('json export', () => {
  it('carries chunk offsets and ids verbatim', () => {
    const parsed = JSON.parse(
      buildTranscriptExport({ video: fixtureVideo, chunks: fixtureChunks }, 'json', { exportedAt: '2026-01-02T03:04:05.000Z' })
    )
    expect(parsed.video_id).toBe('vid-1')
    expect(parsed.exported_at).toBe('2026-01-02T03:04:05.000Z')
    expect(parsed.entries).toHaveLength(3)
    expect(parsed.entries[1]).toMatchObject({
      index: 2,
      chunk_id: 'chunk-2',
      title: 'Witness statement',
      start_seconds: 612.4,
      end_seconds: 672.4,
      text: 'The witness states the door was open.',
    })
  })
})

describe('entry construction', () => {
  it('fills chunks without transcript text from overlapping segments (YouTube flow)', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'seg-1',
        transcript_id: 'tr-1',
        video_id: 'vid-1',
        text_content: 'Before the chunk window.',
        start_time_seconds: 590,
        end_time_seconds: 610,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'seg-2',
        transcript_id: 'tr-1',
        video_id: 'vid-1',
        text_content: 'Overlapping segment text.',
        start_time_seconds: 600,
        end_time_seconds: 680,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    const noTextChunk = chunk({ id: 'chunk-2', start_time_seconds: 612.4, end_time_seconds: 672.4 })
    const entries = buildExportEntries({ video: fixtureVideo, chunks: [noTextChunk], segments })
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('Overlapping segment text.')
    expect(entries[0].startSeconds).toBe(612.4)
  })

  it('falls back to segments as entries when no chunks exist', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 'seg-1',
        transcript_id: 'tr-1',
        video_id: 'vid-1',
        text_content: 'First line.',
        start_time_seconds: 0,
        end_time_seconds: 10,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    const entries = buildExportEntries({ video: fixtureVideo, segments })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ index: 1, chunkId: null, startSeconds: 0, endSeconds: 10, text: 'First line.' })
  })

  it('renders an empty SRT and a bare WEBVTT header with no data', () => {
    expect(buildTranscriptExport({ video: fixtureVideo }, 'srt')).toBe('')
    expect(buildTranscriptExport({ video: fixtureVideo }, 'vtt')).toBe('WEBVTT\n')
  })
})

describe('format validation', () => {
  it('accepts exactly the four evidence formats', () => {
    expect(isTranscriptExportFormat('srt')).toBe(true)
    expect(isTranscriptExportFormat('vtt')).toBe(true)
    expect(isTranscriptExportFormat('md')).toBe(true)
    expect(isTranscriptExportFormat('json')).toBe(true)
    expect(isTranscriptExportFormat('txt')).toBe(false)
    expect(isTranscriptExportFormat(null)).toBe(false)
  })
})
