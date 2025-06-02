import { embed } from 'ai'
import { geminiEmbedding, EMBEDDING_CONFIG } from './gemini'

export interface EmbeddingResult {
  embedding: number[]
  error?: string
}

export async function generateTextEmbedding(text: string): Promise<EmbeddingResult> {
  try {
    if (!text.trim()) {
      return { embedding: [], error: 'Empty text provided' }
    }

    const { embedding } = await embed({
      model: geminiEmbedding,
      value: text.trim()
    })

    // Validate embedding dimensions
    if (embedding.length !== EMBEDDING_CONFIG.dimensions) {
      console.warn(`Unexpected embedding dimension: ${embedding.length}, expected: ${EMBEDDING_CONFIG.dimensions}`)
    }

    return { embedding }
  } catch (error) {
    console.error('Text embedding error:', error)
    return {
      embedding: [],
      error: error instanceof Error ? error.message : 'Failed to generate embedding'
    }
  }
}

export async function generateMultimodalEmbedding(
  transcriptText: string,
  visualDescription: string,
  topics: string[] = []
): Promise<EmbeddingResult> {
  try {
    // Combine multimodal content into a single text representation
    const combinedContent = [
      `Transcript: ${transcriptText}`,
      `Visual: ${visualDescription}`,
      topics.length > 0 ? `Topics: ${topics.join(', ')}` : ''
    ].filter(Boolean).join('\n\n')

    return await generateTextEmbedding(combinedContent)
  } catch (error) {
    console.error('Multimodal embedding error:', error)
    return {
      embedding: [],
      error: error instanceof Error ? error.message : 'Failed to generate multimodal embedding'
    }
  }
}

export async function generateChunkEmbeddings(chunks: Array<{
  id: string
  transcriptText: string
  visualDescription?: string
  topics?: string[]
}>): Promise<Array<{
  chunkId: string
  embedding: number[]
  contentType: 'transcript' | 'multimodal'
  error?: string
}>> {
  const results = []

  for (const chunk of chunks) {
    try {
      let embeddingResult: EmbeddingResult

      if (chunk.visualDescription && chunk.visualDescription.trim()) {
        // Generate multimodal embedding
        embeddingResult = await generateMultimodalEmbedding(
          chunk.transcriptText,
          chunk.visualDescription,
          chunk.topics
        )
        
        results.push({
          chunkId: chunk.id,
          embedding: embeddingResult.embedding,
          contentType: 'multimodal' as const,
          error: embeddingResult.error
        })
      } else {
        // Generate transcript-only embedding
        embeddingResult = await generateTextEmbedding(chunk.transcriptText)
        
        results.push({
          chunkId: chunk.id,
          embedding: embeddingResult.embedding,
          contentType: 'transcript' as const,
          error: embeddingResult.error
        })
      }
    } catch (error) {
      console.error(`Embedding error for chunk ${chunk.id}:`, error)
      results.push({
        chunkId: chunk.id,
        embedding: [],
        contentType: 'transcript' as const,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }

    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  return results
}

export function normalizeEmbedding(embedding: number[]): number[] {
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (norm === 0) return embedding
  return embedding.map(val => val / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length')
  }

  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0)
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))

  if (normA === 0 || normB === 0) return 0
  
  return dotProduct / (normA * normB)
} 