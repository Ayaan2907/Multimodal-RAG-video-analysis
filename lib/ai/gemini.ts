import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import  { env } from "@/app/config/env";

const apiKey = env.GOOGLE_AI_API_KEY!

if (!apiKey) {
  throw new Error('Missing GOOGLE_AI_API_KEY environment variable')
}

// Gemini models for different tasks
export const geminiFlash = google('gemini-2.0-flash-exp')
export const geminiEmbedding = google.textEmbeddingModel('text-embedding-004')

// Video analysis configuration
export const VIDEO_ANALYSIS_CONFIG = {
  maxTokens: 4000,
  temperature: 0.1,
  topP: 0.8,
}

// Embedding configuration  
export const EMBEDDING_CONFIG = {
  dimensions: 768, // text-embedding-004 uses 768 dimensions
}

// Helper function to clean Gemini responses that may be wrapped in markdown
function cleanJsonResponse(text: string): string {
  // Remove markdown code blocks if present
  const cleaned = text
    .replace(/^```json\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .replace(/^```\s*\n?/i, '')
    .trim()
  
  return cleaned
}

export interface VideoAnalysisResult {
  summary: string
  topics: string[]
  entities: string[]
  keyMoments: Array<{
    timestamp: number
    description: string
    importance: number
  }>
  visualDescription: string
}

export async function analyzeVideoContent(
  videoUrl: string,
  transcriptText?: string
): Promise<VideoAnalysisResult> {
  try {
    const prompt = `Analyze this video content and provide:
1. A comprehensive summary
2. Key topics discussed (array of strings)
3. Important entities mentioned (people, places, concepts)
4. Key moments with timestamps and descriptions
5. Visual description of what's happening

${transcriptText ? `Transcript: ${transcriptText}` : ''}

Please respond in JSON format with the exact structure:
{
  "summary": "string",
  "topics": ["string"],
  "entities": ["string"], 
  "keyMoments": [{"timestamp": number, "description": "string", "importance": number}],
  "visualDescription": "string"
}`

    // Use generateText from ai package with gemini model
    const response = await generateText({
      model: geminiFlash,
      prompt,
      ...VIDEO_ANALYSIS_CONFIG
    })

    try {
      const cleanedResponse = cleanJsonResponse(response.text)
      return JSON.parse(cleanedResponse)
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', parseError)
      // Fallback response
      return {
        summary: response.text,
        topics: [],
        entities: [],
        keyMoments: [],
        visualDescription: ''
      }
    }
  } catch (error) {
    console.error('Video analysis error:', error)
    throw new Error('Failed to analyze video content')
  }
}

interface AnalyzedChunk {
  title: string
  description: string
  startTime: number
  endTime: number
  topics: string[]
}

export async function generateTopicBasedChunksWithBatching(
  transcriptSegments: Array<{ text: string; startTime: number; endTime: number }>,
  targetChunkDurationSeconds: number = 300
): Promise<AnalyzedChunk[]> {
  const BATCH_SIZE = 50
  const totalSegments = transcriptSegments.length
  
  console.log(`Processing ${totalSegments} segments in batches of ${BATCH_SIZE}`)

  if (totalSegments === 0) {
    return []
  }

  let allChunks: AnalyzedChunk[] = []

  // Process segments in batches
  for (let i = 0; i < totalSegments; i += BATCH_SIZE) {
    const batch = transcriptSegments.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(totalSegments / BATCH_SIZE)
    
    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} segments)`)

    try {
      const batchChunks = await generateTopicBasedChunks(batch, targetChunkDurationSeconds)
      allChunks = allChunks.concat(batchChunks)
      
      console.log(`Batch ${batchNumber} generated ${batchChunks.length} chunks`)
      
      // Add a small delay between batches to be respectful to the API
      if (i + BATCH_SIZE < totalSegments) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } catch (error) {
      console.error(`Error processing batch ${batchNumber}:`, error)
      
      // Fallback: create simple time-based chunks for this batch
      const fallbackChunks = createFallbackChunks(batch, targetChunkDurationSeconds)
      allChunks = allChunks.concat(fallbackChunks)
      
      console.log(`Batch ${batchNumber} fallback created ${fallbackChunks.length} chunks`)
    }
  }

  console.log(`Total chunks created: ${allChunks.length}`)
  return allChunks
}

function createFallbackChunks(
  segments: Array<{ text: string; startTime: number; endTime: number }>,
  targetDuration: number
): AnalyzedChunk[] {
  if (segments.length === 0) return []
  
  const chunks: AnalyzedChunk[] = []
  const totalDuration = segments[segments.length - 1].endTime - segments[0].startTime
  const chunkCount = Math.max(1, Math.ceil(totalDuration / targetDuration))
  const actualChunkDuration = totalDuration / chunkCount
  
  for (let i = 0; i < chunkCount; i++) {
    const startTime = segments[0].startTime + (i * actualChunkDuration)
    const endTime = i === chunkCount - 1 
      ? segments[segments.length - 1].endTime 
      : startTime + actualChunkDuration
    
    chunks.push({
      title: `Topic ${i + 1}`,
      description: `Content segment covering ${Math.round(startTime)}s to ${Math.round(endTime)}s`,
      startTime,
      endTime,
      topics: ['general']
    })
  }
  
  return chunks
}

export async function generateTopicBasedChunks(
  transcriptSegments: Array<{
    text: string
    startTime: number
    endTime: number
  }>,
  maxChunkDuration: number = 60
): Promise<AnalyzedChunk[]> {
  try {
    // If transcript is too large, return empty to trigger fallback
    if (transcriptSegments.length > 100) {
      console.log(`Transcript too large (${transcriptSegments.length} segments), skipping AI analysis`)
      return []
    }

    const segmentsText = transcriptSegments
      .map(seg => `[${seg.startTime}s-${seg.endTime}s]: ${seg.text}`)
      .join('\n')

    const prompt = `Analyze these timestamped transcript segments and create topic-based chunks.
Each chunk should:
- Be under ${maxChunkDuration} seconds
- Focus on a single topic or concept
- Have a descriptive title and summary
- Include relevant topics

Transcript segments:
${segmentsText}

Please respond in JSON format:
{
  "chunks": [
    {
      "title": "string",
      "description": "string", 
      "startTime": number,
      "endTime": number,
      "topics": ["string"]
    }
  ]
}`

    const response = await generateText({
      model: geminiFlash,
      prompt,
      ...VIDEO_ANALYSIS_CONFIG
    })

    try {
      const cleanedResponse = cleanJsonResponse(response.text)
      const result = JSON.parse(cleanedResponse)
      return result.chunks || []
    } catch (parseError) {
      console.error('Failed to parse chunking response:', parseError)
      return []
    }
  } catch (error) {
    console.error('Topic chunking error:', error)
    return []
  }
}

export async function generateVisualDescription(
  videoUrl: string,
  timestamp: number
): Promise<string> {
  try {
    // This would use Gemini's video understanding to analyze specific frames
    // For now, return a placeholder
    return `Visual content at ${timestamp}s - frame analysis would go here`
  } catch (error) {
    console.error('Visual description error:', error)
    return ''
  }
} 