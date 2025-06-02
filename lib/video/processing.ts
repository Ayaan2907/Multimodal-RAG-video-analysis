import { 
  updateVideoStatus, 
  getVideoById, 
  createTranscript, 
  createTranscriptSegments,
  createVideoChunk,
  createEmbedding,
  getTranscriptTextForChunk
} from '@/lib/supabase/database'
import { getVideoTranscript } from './youtube'
import { generateTopicBasedChunksWithBatching, analyzeVideoContent } from '@/lib/ai/gemini'
import { generateChunkEmbeddings } from '@/lib/ai/embeddings'

const CHUNK_DURATION_SECONDS = parseInt(process.env.CHUNK_DURATION_SECONDS || '60')

export async function processUploadedVideo(videoId: string): Promise<void> {
  await updateVideoStatus(videoId, 'processing')
  
  try {
    const video = await getVideoById(videoId)
    if (!video) {
      throw new Error('Video not found')
    }

    // For uploaded videos, we need to:
    // 1. Extract audio and generate transcript (would need speech-to-text)
    // 2. Analyze video content
    // 3. Create chunks
    // 4. Generate embeddings

    // Mock transcript for now - in production, use speech-to-text
    // Create more realistic mock data for testing
    const mockTranscript = [
      { text: 'Welcome to this video demonstration', start: 0, duration: 3, end: 3 },
      { text: 'Today we will be exploring various concepts', start: 3, duration: 4, end: 7 },
      { text: 'First, let us discuss the main topic', start: 7, duration: 4, end: 11 },
      { text: 'This is an important section about the subject matter', start: 11, duration: 5, end: 16 },
      { text: 'Moving on to the next part of our discussion', start: 16, duration: 4, end: 20 },
      { text: 'Here we can see some interesting details', start: 20, duration: 4, end: 24 },
      { text: 'Let me explain this concept in more depth', start: 24, duration: 5, end: 29 },
      { text: 'This approach has several advantages', start: 29, duration: 4, end: 33 },
      { text: 'We should also consider the implications', start: 33, duration: 4, end: 37 },
      { text: 'Finally, let us summarize what we have learned', start: 37, duration: 5, end: 42 },
      { text: 'Thank you for watching this presentation', start: 42, duration: 4, end: 46 },
      { text: 'Please feel free to ask any questions', start: 46, duration: 4, end: 50 },
    ]

    await processTranscriptAndCreateChunks(videoId, mockTranscript, video.file_path || '')
    
  } catch (error) {
    console.error(`Processing error for video ${videoId}:`, error)
    await updateVideoStatus(videoId, 'failed', error instanceof Error ? error.message : 'Unknown error')
  }
}

export async function processYouTubeVideo(videoId: string, youtubeId: string): Promise<void> {
  await updateVideoStatus(videoId, 'processing')
  
  try {
    const video = await getVideoById(videoId)
    if (!video) {
      throw new Error('Video not found')
    }

    // Fetch YouTube transcript
    await updateVideoStatus(videoId, 'transcribing')
    const transcriptSegments = await getVideoTranscript(youtubeId)
    
    if (transcriptSegments.length === 0) {
      throw new Error('No transcript available for this video')
    }

    await processTranscriptAndCreateChunks(videoId, transcriptSegments, video.source_url || '')
    
  } catch (error) {
    console.error(`YouTube processing error for video ${videoId}:`, error)
    await updateVideoStatus(videoId, 'failed', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function processTranscriptAndCreateChunks(
  videoId: string, 
  transcriptSegments: Array<{ text: string; start: number; duration: number; end: number }>,
  videoUrl: string
): Promise<void> {
  try {
    console.log(`Processing ${transcriptSegments.length} transcript segments for video ${videoId}`)

    // Create full transcript record
    const fullTranscript = transcriptSegments.map(seg => seg.text).join(' ')
    const { id: transcriptId, error: transcriptError } = await createTranscript({
      video_id: videoId,
      content: fullTranscript,
      source: videoUrl.includes('youtube') ? 'youtube' : 'auto'
    })

    if (transcriptError || !transcriptId) {
      throw new Error(`Failed to create transcript: ${transcriptError}`)
    }

    // Create transcript segments
    const segments = transcriptSegments.map(seg => ({
      transcript_id: transcriptId,
      video_id: videoId,
      text_content: seg.text,
      start_time_seconds: seg.start,
      end_time_seconds: seg.end
    }))

    const segmentsCreated = await createTranscriptSegments(segments)
    if (!segmentsCreated) {
      throw new Error('Failed to create transcript segments')
    }

    // Use hybrid approach for chunking
    await updateVideoStatus(videoId, 'chunking')
    let chunks: Array<{
      title: string
      description: string
      start_time_seconds: number
      end_time_seconds: number
      topics: string[]
    }> = []

    try {
      // Use the new batching approach
      const aiChunks = await generateTopicBasedChunksWithBatching(
        transcriptSegments.map(seg => ({
          text: seg.text,
          startTime: seg.start,
          endTime: seg.end
        })),
        CHUNK_DURATION_SECONDS
      )

      // Convert to standardized format (no transcript_text stored)
      chunks = aiChunks.map(chunk => ({
        title: chunk.title,
        description: chunk.description,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime,
        topics: chunk.topics
      }))

      console.log(`Hybrid chunking generated ${chunks.length} chunks`)
    } catch (aiError) {
      console.error('AI chunking failed, using fallback:', aiError)
      
      // Simple fallback: Create time-based chunks
      chunks = createSimpleTimeBasedChunks(transcriptSegments, CHUNK_DURATION_SECONDS)
      console.log(`Fallback chunking created ${chunks.length} chunks`)
    }

    if (chunks.length === 0) {
      throw new Error('No chunks generated from either AI or fallback method')
    }

    // Create video chunks in database (without transcript_text)
    const chunkIds: string[] = []
    for (const chunk of chunks) {
      const { id: chunkId, error: chunkError } = await createVideoChunk({
        video_id: videoId,
        title: chunk.title,
        description: chunk.description,
        start_time_seconds: chunk.start_time_seconds,
        end_time_seconds: chunk.end_time_seconds,
        topics: chunk.topics
      })

      if (chunkError || !chunkId) {
        console.error(`Failed to create chunk: ${chunkError}`)
        continue
      }

      chunkIds.push(chunkId)
    }

    if (chunkIds.length === 0) {
      throw new Error('No chunks created successfully')
    }

    // Generate embeddings (reconstruct transcript text when needed)
    await updateVideoStatus(videoId, 'embedding')
    await generateAndStoreEmbeddings(videoId, chunks, chunkIds)

    // Mark as completed
    await updateVideoStatus(videoId, 'completed')

  } catch (error) {
    console.error('Transcript processing error:', error)
    throw error
  }
}

// Simple fallback function for when AI fails
function createSimpleTimeBasedChunks(
  transcriptSegments: Array<{ text: string; start: number; duration: number; end: number }>,
  chunkDuration: number
): Array<{
  title: string
  description: string
  start_time_seconds: number
  end_time_seconds: number
  topics: string[]
}> {
  console.log(`Creating simple time-based chunks with ${chunkDuration}s duration`)
  
  const chunks: Array<{
    title: string
    description: string
    start_time_seconds: number
    end_time_seconds: number
    topics: string[]
  }> = []
  
  if (transcriptSegments.length === 0) {
    return chunks
  }

  const totalDuration = transcriptSegments[transcriptSegments.length - 1].end
  let currentStart = 0
  let chunkIndex = 1

  while (currentStart < totalDuration) {
    const chunkEnd = Math.min(currentStart + chunkDuration, totalDuration)
    
    chunks.push({
      title: `Segment ${chunkIndex}`,
      description: `Video content from ${Math.round(currentStart)}s to ${Math.round(chunkEnd)}s`,
      start_time_seconds: currentStart,
      end_time_seconds: chunkEnd,
      topics: []
    })
    
    chunkIndex++
    currentStart = chunkEnd
  }

  return chunks
}

async function generateAndStoreEmbeddings(
  videoId: string,
  chunks: Array<{
    title: string
    description: string
    start_time_seconds: number
    end_time_seconds: number
    topics: string[]
  }>,
  chunkIds: string[]
): Promise<void> {
  try {
    // Prepare chunks for embedding generation (reconstruct transcript text)
    const chunksForEmbedding = await Promise.all(
      chunks.map(async (chunk, index) => {
        const transcriptText = await getTranscriptTextForChunk(
          videoId,
          chunk.start_time_seconds,
          chunk.end_time_seconds
        )
        
        return {
          id: chunkIds[index],
          transcriptText,
          visualDescription: '', // Would be generated from video analysis
          topics: chunk.topics
        }
      })
    )

    // Generate embeddings
    const embeddingResults = await generateChunkEmbeddings(chunksForEmbedding)

    // Store embeddings in database
    for (const result of embeddingResults) {
      if (result.error || result.embedding.length === 0) {
        console.error(`Embedding error for chunk ${result.chunkId}: ${result.error}`)
        continue
      }

      const success = await createEmbedding({
        video_id: videoId,
        chunk_id: result.chunkId,
        content_type: result.contentType,
        content_text: chunksForEmbedding.find(c => c.id === result.chunkId)?.transcriptText || '',
        embedding: result.embedding
      })

      if (!success) {
        console.error(`Failed to store embedding for chunk ${result.chunkId}`)
      }
    }

  } catch (error) {
    console.error('Embedding generation error:', error)
    throw error
  }
}

export async function getVideoStatus(videoId: string): Promise<{
  status: string
  error?: string
  progress?: number
} | null> {
  try {
    const video = await getVideoById(videoId)
    if (!video) {
      return null
    }

    return {
      status: video.processing_status,
      error: video.processing_error || undefined,
      progress: getProgressPercentage(video.processing_status)
    }
  } catch (error) {
    console.error('Status check error:', error)
    return null
  }
}

function getProgressPercentage(status: string): number {
  const statusMap: Record<string, number> = {
    'uploading': 10,
    'processing': 25,
    'chunking': 50,
    'transcribing': 60,
    'embedding': 80,
    'completed': 100,
    'failed': 0
  }

  return statusMap[status] || 0
} 