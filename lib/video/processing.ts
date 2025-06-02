import { 
  updateVideoStatus, 
  getVideoById, 
  createTranscript, 
  createTranscriptSegments,
  createVideoChunk,
  createEmbedding
} from '@/lib/supabase/database'
import { getVideoTranscript } from './youtube'
import { generateTopicBasedChunks, analyzeVideoContent } from '@/lib/ai/gemini'
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
    const mockTranscript = [
      { text: 'This is a sample transcript segment', start: 0, duration: 5, end: 5 },
      { text: 'More content would be extracted here', start: 5, duration: 5, end: 10 },
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

    // Generate topic-based chunks
    await updateVideoStatus(videoId, 'chunking')
    let chunks: Array<{
      title: string
      description: string
      startTime: number
      endTime: number
      transcriptText: string
      topics: string[]
    }> = []

    try {
      chunks = await generateTopicBasedChunks(
        transcriptSegments.map(seg => ({
          text: seg.text,
          startTime: seg.start,
          endTime: seg.end
        })),
        CHUNK_DURATION_SECONDS
      )
    } catch (aiError) {
      console.error('AI chunking failed, using fallback:', aiError)
      
      // Fallback: Create simple time-based chunks
      chunks = createTimeBasedChunks(transcriptSegments, CHUNK_DURATION_SECONDS)
    }

    if (chunks.length === 0) {
      throw new Error('No chunks generated')
    }

    // Create video chunks in database
    const chunkIds: string[] = []
    for (const chunk of chunks) {
      const { id: chunkId, error: chunkError } = await createVideoChunk({
        video_id: videoId,
        title: chunk.title,
        description: chunk.description,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime,
        transcript_text: chunk.transcriptText,
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

    // Generate embeddings
    await updateVideoStatus(videoId, 'embedding')
    await generateAndStoreEmbeddings(videoId, chunks, chunkIds)

    // Mark as completed
    await updateVideoStatus(videoId, 'completed')

  } catch (error) {
    console.error('Transcript processing error:', error)
    throw error
  }
}

// Fallback function for simple time-based chunking
function createTimeBasedChunks(
  transcriptSegments: Array<{ text: string; start: number; duration: number; end: number }>,
  chunkDuration: number
): Array<{
  title: string
  description: string
  startTime: number
  endTime: number
  transcriptText: string
  topics: string[]
}> {
  const chunks = []
  let currentChunk = {
    title: '',
    description: '',
    startTime: 0,
    endTime: 0,
    transcriptText: '',
    topics: [] as string[]
  }

  for (const segment of transcriptSegments) {
    if (currentChunk.transcriptText === '') {
      // Start new chunk
      currentChunk.startTime = segment.start
      currentChunk.title = `Segment ${segment.start}s - ${segment.start + chunkDuration}s`
      currentChunk.description = `Video content from ${segment.start} to ${segment.start + chunkDuration} seconds`
    }

    currentChunk.transcriptText += segment.text + ' '
    currentChunk.endTime = segment.end

    // If chunk duration reached, save it and start new one
    if (currentChunk.endTime - currentChunk.startTime >= chunkDuration) {
      chunks.push({ ...currentChunk })
      currentChunk = {
        title: '',
        description: '',
        startTime: 0,
        endTime: 0,
        transcriptText: '',
        topics: []
      }
    }
  }

  // Add final chunk if it has content
  if (currentChunk.transcriptText) {
    chunks.push(currentChunk)
  }

  return chunks
}

async function generateAndStoreEmbeddings(
  videoId: string,
  chunks: Array<{
    title: string
    description: string
    startTime: number
    endTime: number
    transcriptText: string
    topics: string[]
  }>,
  chunkIds: string[]
): Promise<void> {
  try {
    // Prepare chunks for embedding generation
    const chunksForEmbedding = chunks.map((chunk, index) => ({
      id: chunkIds[index],
      transcriptText: chunk.transcriptText,
      visualDescription: '', // Would be generated from video analysis
      topics: chunk.topics
    }))

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