import { GoogleGenAI } from '@google/genai'
import { promises as fs } from 'fs'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getGeminiFlashModel } from '@/lib/config'
import {
  mimeTypeFromExtension,
  parseChunkedResponse,
  parseTimestampedTranscript,
  type GeminiChunk,
} from '../gemini-parsing'
import { TranscriptionProvider, TranscriptSegment, TranscriptionOptions } from '../types'

// Gemini transcription + video understanding provider.
//
// Media attachment design (fixes audit §6.4): media reaches Gemini as a proper
// Files API `fileData` part — never as a URL string in the prompt text, which
// the API does not fetch. Local files and private-bucket objects are uploaded
// to the Files API (polled until ACTIVE); public YouTube URLs are passed as
// fileData directly, which the API fetches natively.

export type { GeminiChunk }

export interface VideoEmbeddingResult {
  description: string
  embedding: number[]
  confidence: number
}

export interface VideoSource {
  type: 'upload' | 'youtube'
  path?: string // For uploads: storage path
  url?: string // For YouTube: video URL
}

export interface VideoSegmentRequest {
  source: VideoSource
  startTime: number
  endTime: number
  frameCount?: number
}

interface AttachedMedia {
  fileUri: string
  mimeType: string
}

const FILE_STATE_POLL_INTERVAL_MS = 2000
const FILE_STATE_TIMEOUT_MS = 5 * 60 * 1000

export class GeminiProvider implements TranscriptionProvider {
  name = 'gemini'
  private ai: GoogleGenAI
  private modelId: string
  // Uploaded Files-API media cached per source so per-chunk embedding calls
  // reuse one upload instead of re-uploading the whole video for each chunk.
  private uploadedMedia = new Map<string, AttachedMedia>()

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google API key is required')
    }
    this.ai = new GoogleGenAI({ apiKey })
    this.modelId = getGeminiFlashModel()
  }

  async transcribe(audioUrl: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]> {
    try {
      const prompt = [
        'Please transcribe this audio file with precise timestamps.',
        'Format each segment as: [START_TIME-END_TIME] TEXT',
        'Where times are in seconds (e.g., [0.0-2.5] Hello world).',
        'Provide word-level or phrase-level timestamps for accurate segmentation.',
        'Include all spoken content with punctuation.',
        options?.language ? `Transcription language: ${options.language}.` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const text = await this.generateFromMediaUrl(audioUrl, prompt)
      return parseTimestampedTranscript(text)
    } catch (error) {
      console.error('Gemini transcription error:', error)

      if (error instanceof Error) {
        if (error.message.includes('API key') || error.message.includes('quota')) {
          throw new Error('Gemini API key invalid, expired, or quota exceeded')
        } else if (error.message.includes('audio')) {
          throw new Error('Audio file format not supported or corrupted')
        }
      }

      throw new Error(`Gemini transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async transcribeFile(filePath: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]> {
    try {
      const media = await this.uploadLocalFile(filePath)
      const prompt = [
        'Please transcribe this audio file with precise timestamps.',
        'Format each segment as: [START_TIME-END_TIME] TEXT',
        'Where times are in seconds (e.g., [0.0-2.5] Hello world).',
        'Include all spoken content with punctuation.',
        options?.language ? `Transcription language: ${options.language}.` : '',
      ]
        .filter(Boolean)
        .join('\n')

      const text = await this.generateFromAttachedMedia(media, prompt)
      return parseTimestampedTranscript(text)
    } catch (error) {
      console.error('Gemini file transcription error:', error)
      throw error
    }
  }

  // Unified transcription + topic chunking in one call over the attached audio.
  async transcribeAndChunk(filePath: string, maxChunkDuration: number = 60): Promise<GeminiChunk[]> {
    try {
      const media = await this.uploadLocalFile(filePath)

      const prompt = `Analyze this audio file and create meaningful topic-based chunks with transcriptions.

REQUIREMENTS:
1. Each chunk should be a natural topic segment (max ${maxChunkDuration} seconds)
2. Identify natural breaks in conversation/content
3. Provide accurate timestamps in seconds
4. Create descriptive titles and summaries for each chunk
5. Extract key topics/themes for each segment
6. Include full transcript text for each chunk

FORMAT your response as JSON:
{
  "chunks": [
    {
      "title": "Descriptive title of this segment",
      "description": "Brief summary of what's discussed",
      "startTime": 0.0,
      "endTime": 45.2,
      "topics": ["topic1", "topic2"],
      "transcript": "Full transcript text for this time segment"
    }
  ]
}`

      const text = await this.generateFromAttachedMedia(media, prompt, { json: true })
      return parseChunkedResponse(text)
    } catch (error) {
      console.error('Gemini transcription error:', error)
      throw error
    }
  }

  // Visual description + embedding of a video segment. The whole video is
  // attached once (cached); the prompt asks the model to focus on the time range.
  async generateVideoEmbedding(request: VideoSegmentRequest): Promise<VideoEmbeddingResult> {
    try {
      const media = await this.resolveVideoMedia(request.source)

      const prompt = `Analyze this video, focusing ONLY on the segment from ${request.startTime} to ${request.endTime} seconds.

Provide a detailed description of:
1. Visual elements (objects, people, scenes, actions)
2. Context and setting
3. Key visual themes or concepts
4. Any text or graphics visible

Focus on visual content that would be useful for search and understanding.`

      const description = await this.generateFromAttachedMedia(media, prompt)

      const { generateTextEmbedding } = await import('@/lib/ai/embeddings')
      const embeddingResult = await generateTextEmbedding(description)

      if (embeddingResult.error) {
        throw new Error(`Embedding generation failed: ${embeddingResult.error}`)
      }

      return {
        description,
        embedding: embeddingResult.embedding,
        confidence: 0.9, // Gemini doesn't return per-description confidence; documented placeholder
      }
    } catch (error) {
      console.error('Video embedding generation error:', error)
      throw new Error(`Failed to generate video embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // ---- media plumbing -------------------------------------------------------

  private async generateFromMediaUrl(url: string, prompt: string, opts?: { json?: boolean }): Promise<string> {
    if (/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
      // Gemini fetches public YouTube URLs natively when passed as fileData.
      return this.generateFromAttachedMedia({ fileUri: url, mimeType: 'video/mp4' }, prompt, opts)
    }

    // Remote media (e.g. storage URLs): fetch the bytes ourselves and attach
    // them via the Files API. Prompt-text URLs are never fetched by the API.
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch media for Gemini: HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = mimeTypeFromExtension(url, response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream')
    const media = await this.uploadBuffer(buffer, mimeType, 'remote-media')
    return this.generateFromAttachedMedia(media, prompt, opts)
  }

  private async generateFromAttachedMedia(
    media: AttachedMedia,
    prompt: string,
    opts?: { json?: boolean },
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.modelId,
      contents: [
        {
          role: 'user',
          parts: [
            { fileData: { fileUri: media.fileUri, mimeType: media.mimeType } },
            { text: prompt },
          ],
        },
      ],
      config: {
        temperature: 0.1,
        maxOutputTokens: 16384,
        ...(opts?.json ? { responseMimeType: 'application/json' } : {}),
      },
    })

    const text = response.text
    if (!text) {
      throw new Error('Gemini returned an empty response')
    }
    return text
  }

  private async uploadLocalFile(filePath: string): Promise<AttachedMedia> {
    const buffer = await fs.readFile(filePath)
    const mimeType = mimeTypeFromExtension(filePath, 'application/octet-stream')
    return this.uploadBuffer(buffer, mimeType, filePath)
  }

  private async resolveVideoMedia(source: VideoSource): Promise<AttachedMedia> {
    const cacheKey = source.type === 'youtube' ? `youtube:${source.url}` : `upload:${source.path}`
    const cached = this.uploadedMedia.get(cacheKey)
    if (cached) return cached

    let media: AttachedMedia
    if (source.type === 'youtube' && source.url) {
      media = { fileUri: source.url, mimeType: 'video/mp4' }
    } else if (source.type === 'upload' && source.path) {
      // Private bucket: mint a short-lived signed URL, fetch bytes, upload once.
      const { data, error } = await getSupabaseAdmin()
        .storage
        .from('videos')
        .createSignedUrl(source.path, 300)

      if (error || !data?.signedUrl) {
        throw new Error(`Failed to create signed URL for stored video: ${error?.message ?? 'unknown error'}`)
      }

      const response = await fetch(data.signedUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch stored video for Gemini: HTTP ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      media = await this.uploadBuffer(buffer, mimeTypeFromExtension(source.path, 'video/mp4'), source.path)
    } else {
      throw new Error('Invalid video source configuration')
    }

    this.uploadedMedia.set(cacheKey, media)
    return media
  }

  private async uploadBuffer(buffer: Buffer, mimeType: string, displayName: string): Promise<AttachedMedia> {
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType })
    const uploaded = await this.ai.files.upload({
      file: blob,
      config: { mimeType, displayName: displayName.split('/').pop()?.slice(0, 40) || 'media' },
    })

    if (!uploaded.name || !uploaded.uri) {
      throw new Error('Gemini Files API upload returned no file reference')
    }

    await this.waitUntilActive(uploaded.name)
    return { fileUri: uploaded.uri, mimeType: uploaded.mimeType ?? mimeType }
  }

  private async waitUntilActive(name: string): Promise<void> {
    const deadline = Date.now() + FILE_STATE_TIMEOUT_MS
    for (;;) {
      const file = await this.ai.files.get({ name })
      if (file.state === 'ACTIVE') return
      if (file.state === 'FAILED') {
        throw new Error(`Gemini Files API processing failed for ${name}`)
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for Gemini Files API to process ${name}`)
      }
      await new Promise((resolve) => setTimeout(resolve, FILE_STATE_POLL_INTERVAL_MS))
    }
  }

  getSupportedFormats(): string[] {
    return ['mp3', 'mp4', 'wav', 'flac', 'm4a', 'ogg', 'webm']
  }

  getMaxFileSize(): number {
    return 2 * 1024 * 1024 * 1024 // 2GB limit (Gemini limit)
  }

  getCostPerHour(): number {
    return 0.00125 // Rough estimate based on Gemini API pricing
  }
}
