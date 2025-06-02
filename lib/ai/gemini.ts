import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

const apiKey = process.env.GOOGLE_AI_API_KEY!

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
      return JSON.parse(response.text)
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

export async function generateTopicBasedChunks(
  transcriptSegments: Array<{
    text: string
    startTime: number
    endTime: number
  }>,
  maxChunkDuration: number = 60
): Promise<Array<{
  title: string
  description: string
  startTime: number
  endTime: number
  transcriptText: string
  topics: string[]
}>> {
  try {
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
      "transcriptText": "string",
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
      const result = JSON.parse(response.text)
      return result.chunks || []
    } catch (parseError) {
      console.error('Failed to parse chunking response:', parseError)
      return []
    }
  } catch (error) {
    console.error('Topic chunking error:', error)
    throw new Error('Failed to generate topic-based chunks')
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