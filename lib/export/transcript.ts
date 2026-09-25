// Transcript export builders — pure functions from stored chunk offsets to
// evidence formats. No I/O: routes fetch the data, this module shapes it, so
// the golden-file tests exercise exactly what ships (spec art_HKWx4t5y §2).

import type { TranscriptSegment, VideoChunk, VideoRecord } from '@/lib/supabase/database'

export const TRANSCRIPT_EXPORT_FORMATS = ['srt', 'vtt', 'md', 'json'] as const
export type TranscriptExportFormat = (typeof TRANSCRIPT_EXPORT_FORMATS)[number]

export function isTranscriptExportFormat(value: string | null): value is TranscriptExportFormat {
  return value !== null && (TRANSCRIPT_EXPORT_FORMATS as readonly string[]).includes(value)
}

export interface TranscriptExportEntry {
  index: number
  chunkId: string | null
  title: string | null
  startSeconds: number
  endSeconds: number
  text: string
}

export interface TranscriptExportInput {
  video: Pick<VideoRecord, 'id' | 'title' | 'source_type' | 'source_url' | 'duration_seconds'>
  chunks?: VideoChunk[]
  segments?: TranscriptSegment[]
}

export interface TranscriptExportOptions {
  /** Stamped into JSON exports; pass a fixed value in tests for determinism. */
  exportedAt?: string
}

// ---------------------------------------------------------------------------
// Timestamp formatting (SRT: HH:MM:SS,mmm — VTT: HH:MM:SS.mmm — clock: H:MM:SS)
// ---------------------------------------------------------------------------

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** 612.4 → "00:10:12,400" (SRT cue timestamp). */
export function formatSrtTimestamp(seconds: number): string {
  return formatDelimitedTimestamp(seconds, ',')
}

/** 612.4 → "00:10:12.400" (WebVTT cue timestamp). */
export function formatVttTimestamp(seconds: number): string {
  return formatDelimitedTimestamp(seconds, '.')
}

function formatDelimitedTimestamp(seconds: number, millisecondSeparator: string): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Invalid timestamp for export: ${seconds}`)
  }
  const totalMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}${millisecondSeparator}${pad(milliseconds, 3)}`
}

/** 612.4 → "10:12" (or "1:02:04" past an hour) — human clock face for markdown/UI. */
export function formatClockTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}`
  }
  return `${pad(minutes, 2)}:${pad(secs, 2)}`
}

// ---------------------------------------------------------------------------
// Entry construction — chunk offsets are the timeline of record
// ---------------------------------------------------------------------------

function segmentTextForRange(
  segments: TranscriptSegment[],
  startSeconds: number,
  endSeconds: number,
): string {
  return segments
    .filter(seg => seg.start_time_seconds < endSeconds && seg.end_time_seconds > startSeconds)
    .map(seg => seg.text_content)
    .join(' ')
    .trim()
}

/**
 * Export entries derive from stored chunk offsets (the chunk timeline is the
 * evidence timeline). Chunk transcript text is used verbatim; chunks stored
 * without text (YouTube flow) are filled from overlapping transcript segments.
 * With no chunks at all, segments become the entries.
 */
export function buildExportEntries(input: TranscriptExportInput): TranscriptExportEntry[] {
  const { chunks = [], segments = [] } = input

  const source =
    chunks.length > 0
      ? chunks.map(chunk => ({
          chunkId: chunk.id,
          title: chunk.title ?? null,
          startSeconds: chunk.start_time_seconds,
          endSeconds: chunk.end_time_seconds,
          text: (chunk.transcript_text ?? segmentTextForRange(segments, chunk.start_time_seconds, chunk.end_time_seconds)).trim(),
        }))
      : segments.map(seg => ({
          chunkId: null,
          title: null,
          startSeconds: seg.start_time_seconds,
          endSeconds: seg.end_time_seconds,
          text: seg.text_content.trim(),
        }))

  return source
    .filter(entry => entry.endSeconds > entry.startSeconds || entry.text.length > 0)
    .map((entry, position) => ({
      index: position + 1,
      chunkId: entry.chunkId,
      title: entry.title,
      startSeconds: entry.startSeconds,
      endSeconds: entry.endSeconds,
      text: entry.text,
    }))
}

// ---------------------------------------------------------------------------
// Format renderers
// ---------------------------------------------------------------------------

export function renderSrt(entries: TranscriptExportEntry[]): string {
  const blocks = entries.map(
    entry =>
      `${entry.index}\n` +
      `${formatSrtTimestamp(entry.startSeconds)} --> ${formatSrtTimestamp(entry.endSeconds)}\n` +
      `${entry.text}`,
  )
  return blocks.length > 0 ? blocks.join('\n\n') + '\n' : ''
}

export function renderVtt(entries: TranscriptExportEntry[]): string {
  if (entries.length === 0) return 'WEBVTT\n'
  const blocks = entries.map(
    entry =>
      `${formatVttTimestamp(entry.startSeconds)} --> ${formatVttTimestamp(entry.endSeconds)}\n` +
      `${entry.text}`,
  )
  return 'WEBVTT\n\n' + blocks.join('\n\n') + '\n'
}

export function renderMarkdown(input: TranscriptExportInput, entries: TranscriptExportEntry[]): string {
  const lines = [`# Transcript — ${input.video.title}`, '']
  for (const entry of entries) {
    const label = entry.title || 'Segment'
    lines.push(
      `## [${formatClockTimestamp(entry.startSeconds)} - ${formatClockTimestamp(entry.endSeconds)}] ${label}`,
      '',
      entry.text,
      '',
    )
  }
  return lines.join('\n')
}

export function renderJson(input: TranscriptExportInput, entries: TranscriptExportEntry[], exportedAt: string): string {
  return JSON.stringify(
    {
      video_id: input.video.id,
      title: input.video.title,
      exported_at: exportedAt,
      entries: entries.map(entry => ({
        index: entry.index,
        chunk_id: entry.chunkId,
        title: entry.title,
        start_seconds: entry.startSeconds,
        end_seconds: entry.endSeconds,
        text: entry.text,
      })),
    },
    null,
    2,
  ) + '\n'
}

export function buildTranscriptExport(
  input: TranscriptExportInput,
  format: TranscriptExportFormat,
  options: TranscriptExportOptions = {},
): string {
  const entries = buildExportEntries(input)
  switch (format) {
    case 'srt':
      return renderSrt(entries)
    case 'vtt':
      return renderVtt(entries)
    case 'md':
      return renderMarkdown(input, entries)
    case 'json':
      return renderJson(input, entries, options.exportedAt ?? new Date().toISOString())
  }
}

export const EXPORT_CONTENT_TYPES: Record<TranscriptExportFormat, string> = {
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
}
