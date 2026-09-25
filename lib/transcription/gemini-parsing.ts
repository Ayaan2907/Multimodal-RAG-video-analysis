// Pure parsing helpers for Gemini responses — no I/O, no env, fully unit-testable.
// (Extracted from the provider so tests don't need the SDK or API keys.)

export interface GeminiChunk {
  title: string
  description: string
  startTime: number
  endTime: number
  topics: string[]
  transcript: string
}

export interface TranscriptSegmentParseResult {
  text: string
  start: number
  end: number
  confidence?: number
}

export function cleanJsonResponse(text: string): string {
  return text
    .replace(/^```json\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^```\s*\n?/i, '')
    .trim()
}

export function parseChunkedResponse(responseText: string): GeminiChunk[] {
  try {
    const parsed = JSON.parse(cleanJsonResponse(responseText)) as {
      chunks?: Array<Record<string, unknown>>
    }

    if (parsed.chunks && Array.isArray(parsed.chunks)) {
      return parsed.chunks.map((chunk) => ({
        title: typeof chunk.title === 'string' && chunk.title ? chunk.title : 'Untitled Segment',
        description: typeof chunk.description === 'string' ? chunk.description : '',
        startTime: Number.parseFloat(String(chunk.startTime)) || 0,
        endTime: Number.parseFloat(String(chunk.endTime)) || 0,
        topics: Array.isArray(chunk.topics) ? chunk.topics.map(String) : [],
        transcript: typeof chunk.transcript === 'string' ? chunk.transcript : '',
      }))
    }

    throw new Error('Invalid chunk format in response')
  } catch (error) {
    console.error('Failed to parse chunked response:', error)
    // Empty array signals the caller to fall back to time-based chunking.
    return []
  }
}

export function parseTimestampedTranscript(transcriptText: string): TranscriptSegmentParseResult[] {
  const segments: TranscriptSegmentParseResult[] = []

  // Matches "[0.0-2.5] text" or "[0:00-0:02] text".
  const timestampRegex = /\[(\d+(?:\.\d+)?(?::\d+)?)-(\d+(?:\.\d+)?(?::\d+)?)\]\s*(.+?)(?=\[|$)/g

  let match
  while ((match = timestampRegex.exec(transcriptText)) !== null) {
    const startTime = parseTime(match[1])
    const endTime = parseTime(match[2])
    const text = match[3].trim()

    if (text && startTime !== null && endTime !== null) {
      segments.push({ text, start: startTime, end: endTime, confidence: 0.95 })
    }
  }

  // Fallback: no timestamps found — approximate one segment per sentence.
  if (segments.length === 0) {
    console.warn('No timestamps found in Gemini response, creating approximate segments')
    const sentences = transcriptText.split(/[.!?]+/).filter((s) => s.trim())
    const avgDuration = 3

    sentences.forEach((sentence, index) => {
      if (sentence.trim()) {
        segments.push({
          text: sentence.trim(),
          start: index * avgDuration,
          end: (index + 1) * avgDuration,
          confidence: 0.8,
        })
      }
    })
  }

  return segments
}

export function parseTime(timeStr: string): number | null {
  try {
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':')
      if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseFloat(parts[1])
      }
      return null
    }
    return parseFloat(timeStr)
  } catch {
    console.warn(`Failed to parse timestamp: ${timeStr}`)
    return null
  }
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.wmv': 'video/x-ms-wmv',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
}

export function mimeTypeFromExtension(path: string, fallback = 'application/octet-stream'): string {
  const dotIndex = path.lastIndexOf('.')
  const ext = dotIndex === -1 ? '' : path.slice(dotIndex).toLowerCase()
  return EXTENSION_MIME_TYPES[ext] ?? fallback
}
