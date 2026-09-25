import { GoogleGenAI } from '@google/genai'
import { getEmbeddingDimensions, getGeminiApiKey, getGeminiEmbeddingModel } from '@/lib/config'

// Embedding generation via the official @google/genai SDK.
//
// gemini-embedding-001 with explicit outputDimensionality (default 768) keeps
// the pgvector column and the match_embeddings RPC compatible. If a model
// change ever returns more dimensions than requested, the Matryoshka-style
// truncation below re-scales instead of failing the insert.

let cachedClient: GoogleGenAI | null = null

function client(): GoogleGenAI {
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey: getGeminiApiKey() })
  }
  return cachedClient
}

export interface EmbeddingResult {
  embedding: number[]
  error?: string
}

export async function generateTextEmbedding(text: string): Promise<EmbeddingResult> {
  try {
    if (!text.trim()) {
      return { embedding: [], error: 'Empty text provided' }
    }

    const dimensions = getEmbeddingDimensions()
    const response = await client().models.embedContent({
      model: getGeminiEmbeddingModel(),
      contents: text.trim(),
      config: { outputDimensionality: dimensions },
    })

    const values = response.embeddings?.[0]?.values ?? []
    if (values.length === 0) {
      return { embedding: [], error: 'Embedding model returned no values' }
    }

    const embedding = coerceEmbeddingDimensions(values, dimensions)
    if (!embedding) {
      return {
        embedding: [],
        error: `Embedding dimension mismatch: got ${values.length}, expected ${dimensions}`,
      }
    }
    return { embedding }
  } catch (error) {
    console.error('Failed to generate text embedding:', error)
    return {
      embedding: [],
      error: error instanceof Error ? error.message : 'Unknown embedding error',
    }
  }
}

export async function generateMultimodalEmbedding(
  transcriptText: string,
  visualDescription: string,
  topics: string[] = []
): Promise<EmbeddingResult> {
  const combinedContent = [
    `Transcript: ${transcriptText}`,
    `Visual: ${visualDescription}`,
    topics.length > 0 ? `Topics: ${topics.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return generateTextEmbedding(combinedContent)
}

export async function generateChunkEmbeddings(
  chunks: Array<{
    id: string
    transcriptText: string
    visualDescription?: string
    topics?: string[]
  }>
): Promise<Array<{
  chunkId: string
  embedding: number[]
  contentType: 'transcript' | 'multimodal'
  error?: string
}>> {
  const results = []

  for (const chunk of chunks) {
    try {
      const embeddingResult =
        chunk.visualDescription && chunk.visualDescription.trim()
          ? await generateMultimodalEmbedding(
              chunk.transcriptText,
              chunk.visualDescription,
              chunk.topics
            )
          : await generateTextEmbedding(chunk.transcriptText)

      results.push({
        chunkId: chunk.id,
        embedding: embeddingResult.embedding,
        contentType: chunk.visualDescription && chunk.visualDescription.trim()
          ? ('multimodal' as const)
          : ('transcript' as const),
        error: embeddingResult.error,
      })
    } catch (error) {
      console.error(`Embedding error for chunk ${chunk.id}:`, error)
      results.push({
        chunkId: chunk.id,
        embedding: [],
        contentType: 'transcript' as const,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Small delay to avoid rate limiting on batch jobs.
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return results
}

export function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return embedding
  return embedding.map((val) => val / magnitude)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimensions mismatch: ${a.length} vs ${b.length}`)
  }

  let dotProduct = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
  }

  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0))
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0))

  if (magnitudeA === 0 || magnitudeB === 0) return 0
  return dotProduct / (magnitudeA * magnitudeB)
}

// Returns null when values are too few; truncates + renormalizes when the
// model ignored outputDimensionality (gemini-embedding-001 embeddings are
// MRL-truncatable).
export function coerceEmbeddingDimensions(values: number[], dimensions: number): number[] | null {
  if (values.length === dimensions) return values
  if (values.length > dimensions) {
    return normalizeEmbedding(values.slice(0, dimensions))
  }
  return null
}
