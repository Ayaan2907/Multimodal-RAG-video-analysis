import { zipSync, strToU8 } from 'fflate'
import { buildTranscriptExport } from '@/lib/export/transcript'
import type { TranscriptSegment, VideoChunk, VideoRecord } from '@/lib/supabase/database'

// SKILL.md export (spec art_HKWx4t5y §4): a zip an agent can drop into its
// skills directory — SKILL.md describing the evidence, references/transcript.md
// holding the timestamped transcript, references/chunks.jsonl one provenance
// record per chunk. Pure module: routes fetch, this shapes.

export interface SkillPackageInput {
  video: Pick<VideoRecord, 'id' | 'title' | 'source_type' | 'source_url' | 'duration_seconds'>
  chunks?: VideoChunk[]
  segments?: TranscriptSegment[]
}

export interface SkillPackageOptions {
  /** Origin for permalink construction, e.g. https://app.example.com */
  origin?: string
}

export interface SkillPackageFiles {
  'SKILL.md': string
  'references/transcript.md': string
  'references/chunks.jsonl': string
}

/** Lowercase alnum + hyphens, for the skill frontmatter name. */
function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || fallback
}

/**
 * YAML double-quoted scalar: titles carry colons, quotes, and backslashes
 * that would otherwise break the frontmatter ("Q&A: Day 1" has a mapping
 * colon inside a plain scalar). Escape \\ and " per YAML 1.2 double-quote
 * rules; titles are single-line by contract (set at ingest).
 */
function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildChunksJsonl(chunks: VideoChunk[]): string {
  const lines = chunks.map(chunk =>
    JSON.stringify({
      chunk_id: chunk.id,
      title: chunk.title ?? null,
      start_time_seconds: chunk.start_time_seconds,
      end_time_seconds: chunk.end_time_seconds,
      transcript_text: chunk.transcript_text ?? null,
      topics: chunk.topics ?? [],
    }),
  )
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

export function buildSkillPackageFiles(input: SkillPackageInput, options: SkillPackageOptions = {}): SkillPackageFiles {
  const { video } = input
  const transcriptMd = buildTranscriptExport(
    { video, chunks: input.chunks ?? [], segments: input.segments ?? [] },
    'md',
  )

  const permalink = options.origin
    ? `${options.origin}/videos/${video.id}`
    : `/videos/${video.id}`

  const description = video.source_type === 'youtube'
    ? `Timestamped transcript evidence for the video "${video.title}".`
    : `Timestamped transcript evidence for the uploaded video "${video.title}".`

  const skillMd = `---
name: ${slugify(video.title, 'video-evidence')}
description: ${yamlQuote(description)}
---

# ${video.title}

Timestamped evidence package for video \`${video.id}\` (source: ${video.source_type}).

- Evidence permalink format: ${permalink}?t=<seconds> — seek to the exact second.
- Transcript with second-level timestamps: references/transcript.md
- Chunk index (id, offsets, topics): references/chunks.jsonl

Cite evidence as the chunk's [start_time_seconds, end_time_seconds] range and
quote the transcript verbatim. Every claim must anchor to a timestamp; do not
paraphrase quotes.
`

  return {
    'SKILL.md': skillMd,
    'references/transcript.md': transcriptMd,
    'references/chunks.jsonl': buildChunksJsonl(input.chunks ?? []),
  }
}

/** Build the zip bytes served by GET /api/v1/videos/{id}/export/skill.md. */
export function buildSkillPackageZip(input: SkillPackageInput, options: SkillPackageOptions = {}): Uint8Array {
  const files = buildSkillPackageFiles(input, options)
  return zipSync({
    'SKILL.md': strToU8(files['SKILL.md']),
    'references/transcript.md': strToU8(files['references/transcript.md']),
    'references/chunks.jsonl': strToU8(files['references/chunks.jsonl']),
  })
}
