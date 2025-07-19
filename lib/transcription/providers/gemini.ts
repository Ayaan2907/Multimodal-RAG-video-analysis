import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { promises as fs } from 'fs'
import { TranscriptionProvider, TranscriptSegment, TranscriptionOptions } from '../types'
import { env } from "@/app/config/env";

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface GeminiChunk {
  title: string
  description: string
  startTime: number
  endTime: number
  topics: string[]
  transcript: string
}

export interface VideoEmbeddingResult {
  description: string
  embedding: number[]
  confidence: number
}

export interface VideoSource {
  type: 'upload' | 'youtube'
  path?: string  // For uploads: storage path
  url?: string   // For YouTube: video URL
}

export interface VideoSegmentRequest {
  source: VideoSource
  startTime: number
  endTime: number
  frameCount?: number
}

export class GeminiProvider implements TranscriptionProvider {
  name = 'gemini'
  private model = google('gemini-2.0-flash-exp')
  
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Google API key is required')
    }
    // API key is handled by @ai-sdk/google via GOOGLE_API_KEY env var
  }

  async transcribe(audioUrl: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]> {
    try {
      console.log(`Starting Gemini transcription for URL: ${audioUrl}`)
      
      // Create transcription prompt with timestamps
      const prompt = `Please transcribe this audio file with precise timestamps. 
      Format each segment as: [START_TIME-END_TIME] TEXT
      Where times are in seconds (e.g., [0.0-2.5] Hello world).
      Provide word-level or phrase-level timestamps for accurate segmentation.
      Include all spoken content with punctuation.
      
      Audio URL: ${audioUrl}`
      
      const response = await generateText({
        model: this.model,
        prompt,
        maxTokens: 4000,
        temperature: 0.1
      })
      
      console.log('Gemini transcription completed')
      
      // Parse the timestamped transcript
      return this.parseTimestampedTranscript(response.text)
      
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
    let audioFileName: string | null = null
    
    try {
      console.log(`Starting Gemini file transcription for: ${filePath}`)
      
      // Upload audio file to Supabase storage
      audioFileName = `audio_gemini_${Date.now()}.mp3`
      const audioBuffer = await fs.readFile(filePath)
      
      const { data, error } = await supabase.storage
        .from('audio-files')
        .upload(audioFileName, audioBuffer, {
          contentType: 'audio/mpeg',
          cacheControl: '3600'
        })

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`)
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('audio-files')
        .getPublicUrl(audioFileName)

      if (!urlData.publicUrl) {
        throw new Error('Failed to get public URL for uploaded audio')
      }

      console.log(`Audio uploaded to storage: ${urlData.publicUrl}`)
      
      // Use the URL-based transcription
      const segments = await this.transcribe(urlData.publicUrl, options)
      
      return segments
      
    } catch (error) {
      console.error('Gemini file transcription error:', error)
      throw error
    } finally {
      // Clean up storage file
      if (audioFileName) {
        try {
          await supabase.storage
            .from('audio-files')
            .remove([audioFileName])
          console.log(`Cleaned up audio file from storage: ${audioFileName}`)
        } catch (cleanupError) {
          console.warn(`Failed to cleanup audio file ${audioFileName}:`, cleanupError)
        }
      }
    }
  }

  // NEW: Unified transcription and chunking method
  async transcribeAndChunk(filePath: string, maxChunkDuration: number = 60): Promise<GeminiChunk[]> {
    let audioFileName: string | null = null
    
    try {
      console.log(`Starting unified Gemini transcription and chunking for: ${filePath}`)
      
      // Upload audio file to Supabase storage
      audioFileName = `audio_gemini_${Date.now()}.mp3`
      const audioBuffer = await fs.readFile(filePath)
      
      const { data, error } = await supabase.storage
        .from('audio-files')
        .upload(audioFileName, audioBuffer, {
          contentType: 'audio/mpeg',
          cacheControl: '3600'
        })

      if (error) {
        throw new Error(`Storage upload failed: ${error.message}`)
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('audio-files')
        .getPublicUrl(audioFileName)

      if (!urlData.publicUrl) {
        throw new Error('Failed to get public URL for uploaded audio')
      }

      console.log(`Audio uploaded to storage: ${urlData.publicUrl}`)
      
      // Unified prompt for transcription and chunking
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
}

Audio URL: ${urlData.publicUrl}`
      
      const response = await generateText({
        model: this.model,
        prompt,
        maxTokens: 10000,
        temperature: 0.1
      })
      
      console.log(' Gemini transcription and chunking completed')
      
      // Parse the JSON response
      const chunks = this.parseChunkedResponse(response.text)
      
      return chunks
      
    } catch (error) {
      console.error('Gemini transcription error:', error)
      throw error
    } finally {
      // Clean up storage file
      if (audioFileName) {
        try {
          await supabase.storage
            .from('audio-files')
            .remove([audioFileName])
          console.log(`Cleaned up audio file from storage: ${audioFileName}`)
        } catch (cleanupError) {
          console.warn(`Failed to cleanup audio file ${audioFileName}:`, cleanupError)
        }
      }
    }
  }

  // NEW: Generate video embeddings for specific segments
  async generateVideoEmbedding(request: VideoSegmentRequest): Promise<VideoEmbeddingResult> {
    try {
      console.log(`Generating video embedding for ${request.source.type} source, ${request.startTime}s-${request.endTime}s`)
      
      let prompt: string
      let mediaInput: any

      if (request.source.type === 'youtube' && request.source.url) {
        // Direct YouTube processing
        prompt = `Analyze this YouTube video segment from ${request.startTime} to ${request.endTime} seconds.

Provide a detailed description of:
1. Visual elements (objects, people, scenes, actions)
2. Context and setting
3. Key visual themes or concepts
4. Any text or graphics visible

Focus on visual content that would be useful for search and understanding.

YouTube URL: ${request.source.url}
Time segment: ${request.startTime}s - ${request.endTime}s`

        mediaInput = request.source.url

      } else if (request.source.type === 'upload' && request.source.path) {
        // Upload video processing via storage URL
        const { data: urlData } = supabase.storage
          .from('videos')
          .getPublicUrl(request.source.path)

        if (!urlData.publicUrl) {
          throw new Error('Failed to get public URL for uploaded video')
        }

        prompt = `Analyze this video segment from ${request.startTime} to ${request.endTime} seconds.

Provide a detailed description of:
1. Visual elements (objects, people, scenes, actions)  
2. Context and setting
3. Key visual themes or concepts
4. Any text or graphics visible

Focus on visual content that would be useful for search and understanding.

Video URL: ${urlData.publicUrl}
Time segment: ${request.startTime}s - ${request.endTime}s
${request.frameCount ? `Analyze approximately ${request.frameCount} key frames from this segment.` : ''}`

        mediaInput = urlData.publicUrl

      } else {
        throw new Error('Invalid video source configuration')
      }

      // Generate video understanding with Gemini
      const response = await generateText({
        model: this.model,
        prompt,
        maxTokens: 2000,
        temperature: 0.1
      })

      // Generate embedding from the visual description
      const { generateTextEmbedding } = await import('@/lib/ai/embeddings')
      const embeddingResult = await generateTextEmbedding(response.text)

      if (embeddingResult.error) {
        throw new Error(`Embedding generation failed: ${embeddingResult.error}`)
      }

      return {
        description: response.text,
        embedding: embeddingResult.embedding,
        confidence: 0.9 // Gemini confidence placeholder
      }

    } catch (error) {
      console.error('Video embedding generation error:', error)
      throw new Error(`Failed to generate video embedding: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private parseChunkedResponse(responseText: string): GeminiChunk[] {
    try {
      // Clean JSON response (remove markdown if present)
      const cleanedResponse = responseText
        .replace(/^```json\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .replace(/^```\s*\n?/i, '')
        .trim()
      
      const parsed = JSON.parse(cleanedResponse)
      
      if (parsed.chunks && Array.isArray(parsed.chunks)) {
        return parsed.chunks.map((chunk: any) => ({
          title: chunk.title || 'Untitled Segment',
          description: chunk.description || '',
          startTime: parseFloat(chunk.startTime) || 0,
          endTime: parseFloat(chunk.endTime) || 0,
          topics: Array.isArray(chunk.topics) ? chunk.topics : [],
          transcript: chunk.transcript || ''
        }))
      }
      
      throw new Error('Invalid chunk format in response')
    } catch (error) {
      console.error('Failed to parse chunked response:', error)
      // Fallback: return empty array to trigger fallback chunking
      return []
    }
  }

  private parseTimestampedTranscript(transcriptText: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = []
    
    // Look for patterns like [0.0-2.5] text or [0:00-0:02] text (fixed regex)
    const timestampRegex = /\[(\d+(?:\.\d+)?(?::\d+)?)-(\d+(?:\.\d+)?(?::\d+)?)\]\s*(.+?)(?=\[|$)/g
    
    let match
    while ((match = timestampRegex.exec(transcriptText)) !== null) {
      const startTime = this.parseTime(match[1])
      const endTime = this.parseTime(match[2])
      const text = match[3].trim()
      
      if (text && startTime !== null && endTime !== null) {
        segments.push({
          text,
          start: startTime,
          end: endTime,
          confidence: 0.95 // Gemini doesn't provide confidence scores
        })
      }
    }
    
    // Fallback: if no timestamps found, try to split by sentences
    if (segments.length === 0) {
      console.warn('No timestamps found in Gemini response, creating approximate segments')
      const sentences = transcriptText.split(/[.!?]+/).filter(s => s.trim())
      const avgDuration = 3 // Assume 3 seconds per sentence
      
      sentences.forEach((sentence, index) => {
        if (sentence.trim()) {
          segments.push({
            text: sentence.trim(),
            start: index * avgDuration,
            end: (index + 1) * avgDuration,
            confidence: 0.8
          })
        }
      })
    }
    
    return segments
  }

  private parseTime(timeStr: string): number | null {
    try {
      // Handle formats like "1.5" or "1:30"
      if (timeStr.includes(':')) {
        const parts = timeStr.split(':')
        if (parts.length === 2) {
          return parseInt(parts[0]) * 60 + parseFloat(parts[1])
        }
      } else {
        return parseFloat(timeStr)
      }
    } catch (error) {
      console.warn(`Failed to parse timestamp: ${timeStr}`)
    }
    return null
  }

  getSupportedFormats(): string[] {
    return [
      'mp3', 'mp4', 'wav', 'flac', 'm4a', 'ogg', 'webm'
    ]
  }

  getMaxFileSize(): number {
    return 2 * 1024 * 1024 * 1024 // 2GB limit (Gemini limit)
  }

  getCostPerHour(): number {
    return 0.00125 // Rough estimate based on Gemini API pricing
  }
} 