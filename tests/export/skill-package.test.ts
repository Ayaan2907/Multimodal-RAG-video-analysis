import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildSkillPackageFiles, buildSkillPackageZip } from '@/lib/export/skill-package'

// SKILL.md export (spec art_HKWx4t5y §4): the zip an agent imports must contain
// SKILL.md, references/transcript.md and references/chunks.jsonl, and the
// transcript must keep the same second-level timestamps the API serves.

const VIDEO = {
  id: 'vid-abc',
  title: 'Deposition — Day 1',
  source_type: 'youtube' as const,
  source_url: 'https://youtube.com/watch?v=abc',
  duration_seconds: 300,
}

const CHUNKS = [
  {
    id: 'chunk-1',
    video_id: VIDEO.id,
    chunk_index: 0,
    title: 'Opening',
    start_time_seconds: 0,
    end_time_seconds: 10.5,
    transcript_text: 'The contract was signed on March third.',
    topics: ['contract'],
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'chunk-2',
    video_id: VIDEO.id,
    chunk_index: 1,
    title: 'Testimony',
    start_time_seconds: 10.5,
    end_time_seconds: 20,
    transcript_text: 'The witness identified the signature.',
    topics: ['testimony'],
    created_at: '2026-01-01T00:00:00.000Z',
  },
]

const SEGMENTS = [
  { id: 'seg-1', video_id: VIDEO.id, segment_index: 0, start_time_seconds: 0, end_time_seconds: 10.5, text: 'The contract was signed on March third.' },
  { id: 'seg-2', video_id: VIDEO.id, segment_index: 1, start_time_seconds: 10.5, end_time_seconds: 20, text: 'The witness identified the signature.' },
] as never

const BASE_INPUT = { video: VIDEO, chunks: CHUNKS, segments: SEGMENTS }

describe('buildSkillPackageZip', () => {
  it('produces a zip with SKILL.md and the two reference files', () => {
    const zip = buildSkillPackageZip(BASE_INPUT)
    const unzipped = unzipSync(zip)
    expect(Object.keys(unzipped).sort()).toEqual([
      'SKILL.md',
      'references/chunks.jsonl',
      'references/transcript.md',
    ])
  })

  it('SKILL.md carries a valid name slug, the video id, and the permalink format', () => {
    const zip = buildSkillPackageZip(BASE_INPUT, { origin: 'https://app.example.com' })
    const skillMd = strFromU8(unzipSync(zip)['SKILL.md'])
    expect(skillMd).toContain('name: deposition-day-1')
    expect(skillMd).toContain(VIDEO.id)
    expect(skillMd).toContain('https://app.example.com/videos/vid-abc?t=<seconds>')
    expect(skillMd).toContain('references/transcript.md')
    expect(skillMd).toContain('references/chunks.jsonl')
  })

  it('chunks.jsonl is one JSON record per chunk with offsets and topics', () => {
    const zip = buildSkillPackageZip(BASE_INPUT)
    const jsonl = strFromU8(unzipSync(zip)['references/chunks.jsonl'])
    const lines = jsonl.trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!)
    expect(first).toMatchObject({
      chunk_id: 'chunk-1',
      start_time_seconds: 0,
      end_time_seconds: 10.5,
      transcript_text: 'The contract was signed on March third.',
      topics: ['contract'],
    })
  })

  it('transcript.md matches the API transcript export (same timestamps)', () => {
    const zip = buildSkillPackageZip(BASE_INPUT)
    const transcript = strFromU8(unzipSync(zip)['references/transcript.md'])
    // Clock-face format from the shared exporter: m:ss under an hour.
    expect(transcript).toContain('## [00:00 - 00:10] Opening')
    expect(transcript).toContain('## [00:10 - 00:20] Testimony')
    expect(transcript).toContain('The contract was signed on March third.')
    expect(transcript).toContain('The witness identified the signature.')
  })

  it('falls back to a generic slug when the title has no slug characters', () => {
    const zip = buildSkillPackageZip({ video: { ...VIDEO, title: '???' } })
    expect(strFromU8(unzipSync(zip)['SKILL.md'])).toContain('name: video-evidence')
  })

  it('quotes the frontmatter description so titles with colons and quotes stay valid YAML', () => {
    const zip = buildSkillPackageZip({ video: { ...VIDEO, title: 'Q&A: "Cross" exam \\ day 1' } })
    const skillMd = strFromU8(unzipSync(zip)['SKILL.md'])
    const descriptionLine = skillMd
      .split('\n')
      .find(line => line.startsWith('description: '))
    // Double-quoted scalar: no bare colon outside quotes; inner quotes and
    // Round-trip check: the value is a YAML double-quoted scalar — strip the
    // outer quotes, unescape (\" → ", \\ → \), and it must equal the plain
    // description built from the title.
    expect(descriptionLine?.startsWith('description: "') && descriptionLine.endsWith('"')).toBe(true)
    const quoted = descriptionLine!.slice('description: '.length + 1, -1)
    expect(quoted.replace(/\\(.)/g, '$1')).toBe(
      'Timestamped transcript evidence for the video "Q&A: "Cross" exam \\ day 1".',
    )
  })
})
describe('buildSkillPackageFiles', () => {
  it('is deterministic for identical input (no clock dependency)', () => {
    expect(buildSkillPackageFiles(BASE_INPUT)).toEqual(buildSkillPackageFiles(BASE_INPUT))
  })
})
