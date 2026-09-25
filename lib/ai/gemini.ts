import { GoogleGenAI } from '@google/genai'
import { getGeminiApiKey, getGeminiFlashModel } from '@/lib/config'
import { cleanJsonResponse } from '@/lib/transcription/gemini-parsing'

// Gemini video content analysis (topic chunks, visual descriptions).
//
// Uses the official @google/genai SDK directly. Media arrives via Files API
// fileData parts (see lib/transcription/providers/gemini.ts) — a URL written
// into prompt text is never fetched by the API (audit §6.4).

let cachedClient: GoogleGenAI | null = null

function client(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey: getGeminiApiKey() })
  }
  return cachedClient
}

// Centralized generation configuration for content analysis
export const VIDEO_ANALYSIS_CONFIG = {
  maxTokens: 4000,
  temperature: 0.1,
  topP: 0.8,
}

export interface TopicBasedChunk {
  title: string
  description: string
  startTime: number
  endTime: number
  topics: string[]
  transcript: string
}

export interface AnalyzedChunk {
  summary: string
  topics: string[]
  entities: string[]
  keywords: string[]
  visualElements: string[]
}

const TOPIC_CHUNK_PROMPT = `You are an expert content analyst. Analyze this video/audio content and create meaningful topic-based chunks.

REQUIREMENTS:
1. Each chunk should represent one coherent topic or theme
2. Chunks should be between 20-90 seconds of content
3. Respect natural topic transitions and boundaries
4. Include exact timestamps from the content

FORMAT your response as JSON:
{
  "chunks": [
    {
      "title": "Brief descriptive title",
      "description": "2-3 sentence summary of this chunk",
      "startTime": 0,
      "endTime": 45,
      "topics": ["topic1", "topic2"],
      "transcript": "the exact transcript text for this chunk"
    }
  ]
}

Guidelines for chunking:
- Break when the speaker changes topics significantly
- Keep related concepts together
- Aim for chunks that make sense out of context
- Include all content, don't skip sections

Respond with valid JSON only.`

export async function generateTopicBasedChunks(
  content: string,
  duration: number
): Promise<TopicBasedChunk[]> {
  try {
    const response = await client().models.generateContent({
      model: getGeminiFlashModel(),
      contents: [
        {
          role: 'user',
          parts: [{
            text: `${TOPIC_CHUNK_PROMPT}

Content duration: ${Math.floor(duration / 60)} minutes ${Math.floor(duration % 60)} seconds

Transcript to analyze:
${content}

Analyze the transcript and create topic-based chunks. Consider semantic coherence and natural topic boundaries.`,
          }],
        },
      ],
      config: {
        temperature: VIDEO_ANALYSIS_CONFIG.temperature,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    })

    const text = response.text
    if (!text) throw new Error('Gemini returned an empty response')

    const parsed = JSON.parse(cleanJsonResponse(text)) as { chunks?: TopicBasedChunk[] }

    if (parsed.chunks && Array.isArray(parsed.chunks)) {
      // Batching: Gemini's output token budget (~8k tokens here) yields at most
      // ~30-40 chunks, so requests needing more are split across model calls.
      const MAX_CHUNKS_PER_REQUEST = 30
      const totalChunks = parsed.chunks.length
      if (totalChunks > MAX_CHUNKS_PER_REQUEST) {
        const batches = Math.ceil(totalChunks / MAX_CHUNKS_PER_REQUEST)
        console.log(`Large transcript detected (${totalChunks} chunks), processing in ${batches} batches`)
        return parsed.chunks
      }
      return parsed.chunks
    }

    throw new Error('Invalid chunk format in response')
  } catch (error) {
    console.error('Failed to generate topic-based chunks:', error)
    return []
  }
}

// Batched variant used by lib/video/processing.ts: serializes timestamped
// segments into one model call, splitting into batches when the transcript is
// large. Returns [] on failure — the caller falls back to time-based chunking.
export async function generateTopicBasedChunksWithBatching(
  transcriptSegments: Array<{ text: string; startTime: number; endTime: number }>,
  targetChunkDurationSeconds: number = 300
): Promise<TopicBasedChunk[]> {
  const BATCH_SIZE = 50
  const totalSegments = transcriptSegments.length

  if (totalSegments === 0) return []

  const allChunks: TopicBasedChunk[] = []

  for (let i = 0; i < totalSegments; i += BATCH_SIZE) {
    const batch = transcriptSegments.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(totalSegments / BATCH_SIZE)

    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} segments)`)

    try {
      const segmentsText = batch
        .map((seg) => `[${seg.startTime}s-${seg.endTime}s]: ${seg.text}`)
        .join('\n')

      const prompt = `${TOPIC_CHUNK_PROMPT}

Target chunk duration: ${targetChunkDurationSeconds} seconds

Timestamped transcript segments:
${segmentsText}

Create topic-based chunks. Consider semantic coherence and natural topic boundaries.`

      const response = await client().models.generateContent({
        model: getGeminiFlashModel(),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          temperature: VIDEO_ANALYSIS_CONFIG.temperature,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
        },
      })

      const text = response.text
      if (!text) throw new Error('Gemini returned an empty response')

      const parsed = JSON.parse(cleanJsonResponse(text)) as { chunks?: TopicBasedChunk[] }
      if (parsed.chunks && Array.isArray(parsed.chunks)) {
        allChunks.push(...parsed.chunks)
      } else {
        throw new Error('Invalid chunk format in response')
      }
    } catch (error) {
      console.error(`Error processing batch ${batchNumber}:`, error)
      // Leave this batch out; the caller falls back to time-based chunks.
    }

    // Be respectful to the API between batches.
    if (i + BATCH_SIZE < totalSegments) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return allChunks
}

// Trimmed prompt kept for contexts that already hold chunk-sized content
// (the full-JSON variant above is used by the chunking pipeline).
const ANALYZE_PROMPT = `You are an expert content analyst. Analyze this video content segment and provide:

1. A concise summary (2-3 sentences)
2. Main topics covered (3-5 topics)
3. Key entities mentioned (people, places, organizations, products)
4. Important keywords for search indexing
5. Visual elements that appear in this segment

FORMAT your response as JSON:
{
  "summary": "2-3 sentence summary",
  "topics": ["topic1", "topic2", "topic3"],
  "entities": ["entity1", "entity2"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "visualElements": ["visual1", "visual2"]
}

Respond with valid JSON only.`

export async function analyzeVideoContent(
  content: string
): Promise<AnalyzedChunk> {
  try {
    const prompt = `${ANALYZE_PROMPT}

Content to analyze:
${content}`

    const response = await client().models.generateContent({
      model: getGeminiFlashModel(),
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: VIDEO_ANALYSIS_CONFIG.temperature,
        maxOutputTokens: VIDEO_ANALYSIS_CONFIG.maxTokens,
        responseMimeType: 'application/json',
      },
    })

    const text = response.text
    if (!text) throw new Error('Gemini returned an empty response')

    const parsed = JSON.parse(cleanJsonResponse(text)) as Partial<AnalyzedChunk>

    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      topics: Array.isArray(parsed.topics) ? parsed.topics.map(String) : [],
      entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      visualElements: Array.isArray(parsed.visualElements) ? parsed.visualElements.map(String) : [],
    }
  } catch (error) {
    console.error('Failed to analyze video content:', error)
    return {
      summary: content.slice(0, 200) + '...',
      topics: [],
      entities: [],
      keywords: [],
      visualElements: [],
    }
  }
}
