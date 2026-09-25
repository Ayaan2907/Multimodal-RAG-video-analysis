import { describe, expect, it } from 'vitest'
import {
  buildChatSources,
  extractVerbatimQuote,
  type ChatSourceMatch,
} from '@/lib/evidence/chat-sources'

// Acceptance proof (spec art_HKWx4t5y): every chat source quote must appear
// exactly in the transcript. Quotes are anchored to the stored transcript —
// anything that cannot be anchored verbatim is dropped, never paraphrased.

const FULL_TRANSCRIPT = 'Officer arrives on scene. The witness states the door was open. Chain of custody begins here.'

function match(overrides: Partial<ChatSourceMatch> & Pick<ChatSourceMatch, 'chunkId'>): ChatSourceMatch {
  return {
    title: null,
    startSeconds: 612.4,
    endSeconds: 672.4,
    contentType: 'transcript',
    similarity: 0.82,
    matchedText: null,
    chunkTranscriptText: null,
    ...overrides,
  }
}

const segments = [
  { text: 'Officer arrives on scene.', startSeconds: 0, endSeconds: 30 },
  { text: 'The witness states the door was open.', startSeconds: 612, endSeconds: 672 },
  { text: 'Chain of custody begins here.', startSeconds: 730, endSeconds: 790 },
]

describe('extractVerbatimQuote', () => {
  it('returns the matched transcript span when it is already exact', () => {
    const quote = extractVerbatimQuote(
      match({ chunkId: 'c1', matchedText: 'The witness states the door was open.' }),
      { fullTranscript: FULL_TRANSCRIPT, segments },
    )
    expect(quote).toBe('The witness states the door was open.')
  })

  it('re-anchors a whitespace-mangled candidate to the exact transcript span', () => {
    const quote = extractVerbatimQuote(
      match({ chunkId: 'c1', matchedText: 'The witness states\nthe door   was open.' }),
      { fullTranscript: FULL_TRANSCRIPT, segments },
    )
    // The returned quote is the raw transcript span, not the mangled candidate.
    expect(quote).toBe('The witness states the door was open.')
    expect(FULL_TRANSCRIPT.includes(quote!)).toBe(true)
  })

  it('falls back to the chunk transcript text for visual matches', () => {
    const quote = extractVerbatimQuote(
      match({ chunkId: 'c1', contentType: 'visual', matchedText: 'A hallway camera frame', chunkTranscriptText: 'Chain of custody begins here.' }),
      { fullTranscript: FULL_TRANSCRIPT, segments },
    )
    expect(quote).toBe('Chain of custody begins here.')
  })

  it('falls back to overlapping segments when neither match nor chunk text fits', () => {
    const quote = extractVerbatimQuote(
      match({ chunkId: 'c1', contentType: 'multimodal', matchedText: 'Not in the transcript' }),
      { fullTranscript: FULL_TRANSCRIPT, segments },
    )
    expect(quote).toBe('The witness states the door was open.')
  })

  it('returns null when the transcript cannot support any candidate', () => {
    const quote = extractVerbatimQuote(
      match({ chunkId: 'c1', contentType: 'visual', matchedText: 'A hallway camera frame' }),
      { fullTranscript: FULL_TRANSCRIPT, segments: [] },
    )
    expect(quote).toBeNull()
  })
})

describe('buildChatSources', () => {
  it('carries chunk ids, seconds ranges, and similarity in the API contract shape', () => {
    const sources = buildChatSources({
      videoId: 'vid-9',
      matches: [
        match({ chunkId: 'c1', title: 'Witness statement', matchedText: 'The witness states the door was open.', similarity: 0.9 }),
      ],
      fullTranscript: FULL_TRANSCRIPT,
      segments,
    })
    expect(sources).toHaveLength(1)
    expect(sources[0]).toEqual({
      chunk_id: 'c1',
      video_id: 'vid-9',
      start_seconds: 612.4,
      end_seconds: 672.4,
      quote: 'The witness states the door was open.',
      similarity: 0.9,
      title: 'Witness statement',
      matched_on: 'transcript',
    })
  })

  it('drops sources that cannot be verbatim-anchored — never emits fabricated quotes', () => {
    const sources = buildChatSources({
      videoId: 'vid-9',
      matches: [
        match({ chunkId: 'c-anchored', matchedText: 'Officer arrives on scene.' }),
        match({ chunkId: 'c-unanchorable', contentType: 'visual', matchedText: 'A shadow moves across the wall', similarity: 0.75 }),
      ],
      fullTranscript: FULL_TRANSCRIPT,
      segments: [],
    })
    expect(sources.map(s => s.chunk_id)).toEqual(['c-anchored'])
  })

  it('every emitted quote appears exactly in the transcript (acceptance invariant)', () => {
    const sources = buildChatSources({
      videoId: 'vid-9',
      matches: [
        match({ chunkId: 'c1', matchedText: 'Officer arrives on scene.' }),
        match({ chunkId: 'c2', matchedText: 'The  witness states\nthe door was open.' }),
        match({ chunkId: 'c3', contentType: 'multimodal', matchedText: 'combined embedding text', chunkTranscriptText: 'Chain of custody begins here.' }),
      ],
      fullTranscript: FULL_TRANSCRIPT,
      segments,
    })
    expect(sources).toHaveLength(3)
    for (const source of sources) {
      expect(FULL_TRANSCRIPT.includes(source.quote)).toBe(true)
    }
  })
})
