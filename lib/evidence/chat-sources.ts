// Verbatim-quote source construction for chat answers. Every source must be
// anchored: its quote is either an exact span of the stored transcript or is
// re-anchored to the exact span; sources that cannot be anchored are dropped —
// a paraphrased "quote" is fabricated evidence (spec art_HKWx4t5y §2).

export interface ChatSourceMatch {
  chunkId: string
  title: string | null
  startSeconds: number
  endSeconds: number
  contentType: 'transcript' | 'visual' | 'multimodal'
  similarity: number
  /** content_text of the matched embedding (transcript span, or a description). */
  matchedText: string | null
  /** transcript_text stored on the chunk, when present (upload flow). */
  chunkTranscriptText: string | null
}

export interface ChatSource {
  chunk_id: string
  video_id: string
  start_seconds: number
  end_seconds: number
  quote: string
  similarity: number
  title: string | null
  matched_on: 'transcript' | 'visual' | 'multimodal'
}

export interface ChatSourceInput {
  videoId: string
  matches: ChatSourceMatch[]
  fullTranscript: string
  segments: Array<{ text: string; startSeconds: number; endSeconds: number }>
}

/** Collapse whitespace runs so "a  b\nc" matches "a b c" for locating. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Find `candidate` inside `source` ignoring whitespace differences and return
 * the EXACT span from `source` (verbatim by construction), or null.
 */
function anchorExactSpan(source: string, candidate: string): string | null {
  const normalizedSource = normalizeWhitespace(source)
  const normalizedCandidate = normalizeWhitespace(candidate)
  if (!normalizedCandidate) return null

  const located = normalizedSource.indexOf(normalizedCandidate)
  if (located === -1) return null

  // Map the normalized span back to raw source offsets via a position map.
  const positionMap: number[] = []
  let normalizedIndex = 0
  let inWhitespace = false
  for (let rawIndex = 0; rawIndex < source.length; rawIndex++) {
    const char = source[rawIndex]
    if (/\s/.test(char)) {
      // One whitespace run maps to the single normalized space; leading and
      // trailing runs (trimmed away) map nowhere.
      if (!inWhitespace && normalizedIndex > 0) {
        positionMap[normalizedIndex] = rawIndex
        normalizedIndex++
        inWhitespace = true
      }
    } else {
      positionMap[normalizedIndex] = rawIndex
      normalizedIndex++
      inWhitespace = false
    }
  }

  const rawStart = positionMap[located]
  const rawEnd = positionMap[located + normalizedCandidate.length - 1]
  if (rawStart === undefined || rawEnd === undefined) return null

  return source.slice(rawStart, rawEnd + 1)
}

/** The verbatim quote candidate, in priority order for a match. */
function quoteCandidates(match: ChatSourceMatch, segments: ChatSourceInput['segments']): string[] {
  const candidates: string[] = []
  if (match.contentType === 'transcript' && match.matchedText) {
    candidates.push(match.matchedText)
  }
  if (match.chunkTranscriptText) {
    candidates.push(match.chunkTranscriptText)
  }
  const overlap = segments
    .filter(seg => seg.startSeconds < match.endSeconds && seg.endSeconds > match.startSeconds)
    .map(seg => seg.text)
    .join(' ')
    .trim()
  if (overlap) candidates.push(overlap)
  return candidates
}

/**
 * Anchor a verbatim quote for one match against the stored transcript.
 * Falls back to exact-span anchoring so the returned quote is always an
 * exact substring of `fullTranscript` — never paraphrased. Null when the
 * transcript cannot support the quote.
 */
export function extractVerbatimQuote(
  match: ChatSourceMatch,
  input: Pick<ChatSourceInput, 'fullTranscript' | 'segments'>,
): string | null {
  const fullTranscript = input.fullTranscript
  for (const candidate of quoteCandidates(match, input.segments)) {
    if (fullTranscript.includes(candidate)) return candidate
    const anchored = anchorExactSpan(fullTranscript, candidate)
    if (anchored) return anchored
  }
  return null
}

/**
 * Build the source list for a chat answer. Sources that cannot be verbatim-
 * anchored to the transcript are dropped — never emitted with a fabricated
 * quote.
 */
export function buildChatSources(input: ChatSourceInput): ChatSource[] {
  const sources: ChatSource[] = []
  for (const match of input.matches) {
    const quote = extractVerbatimQuote(match, input)
    if (!quote) continue
    sources.push({
      chunk_id: match.chunkId,
      video_id: input.videoId,
      start_seconds: match.startSeconds,
      end_seconds: match.endSeconds,
      quote,
      similarity: match.similarity,
      title: match.title,
      matched_on: match.contentType,
    })
  }
  return sources
}
