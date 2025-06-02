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
import { TranscriptionFactory } from '@/lib/transcription/factory'
import { GeminiProvider, GeminiChunk } from '@/lib/transcription/providers/gemini'
import { extractAudioFromVideo, checkFFmpegAvailability, cleanupAudioFile } from './audio-extraction'
import { TranscriptSegment as TranscriptionSegment } from '@/lib/transcription/types'

const CHUNK_DURATION_SECONDS = parseInt(process.env.CHUNK_DURATION_SECONDS || '60')

export async function processUploadedVideo(videoId: string, audioFilePath?: string): Promise<void> {
  await updateVideoStatus(videoId, 'processing')
  
  try {
    const video = await getVideoById(videoId)
    if (!video) {
      throw new Error('Video not found')
    }

    if (!audioFilePath) {
      throw new Error('Audio file path is required for uploaded video processing')
    }
    
    // Get transcription provider
    const provider = TranscriptionFactory.create()
    console.log(`Using transcription provider: ${provider.name}`)
    
    // Use unified approach if Gemini provider
    if (provider instanceof GeminiProvider) {
      await processWithUnifiedGemini(videoId, audioFilePath, provider)
    } else {
      // Fallback: Use traditional transcription + chunking approach
      await processWithTraditionalApproach(videoId, audioFilePath, provider)
    }
    
  } catch (error) {
    console.error(`Processing error for video ${videoId}:`, error)
    await updateVideoStatus(videoId, 'failed', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function processWithUnifiedGemini(
  videoId: string, 
  audioFilePath: string, 
  provider: GeminiProvider
): Promise<void> {
  try {
    // Unified transcription and chunking
    await updateVideoStatus(videoId, 'transcribing')
    console.log(`Starting unified Gemini transcription and chunking`)
    
    const geminiChunks = await provider.transcribeAndChunk(audioFilePath, CHUNK_DURATION_SECONDS)
    
    if (geminiChunks.length === 0) {
      throw new Error('No chunks generated from Gemini unified processing')
    }

    console.log(`Unified processing completed: ${geminiChunks.length} chunks`)

    // Create full transcript from chunks
    const fullTranscript = geminiChunks.map(chunk => chunk.transcript).join(' ')
    const { id: transcriptId, error: transcriptError } = await createTranscript({
      video_id: videoId,
      content: fullTranscript,
      source: 'gemini'
    })

    if (transcriptError || !transcriptId) {
      throw new Error(`Failed to create transcript: ${transcriptError}`)
    }

    // Create transcript segments from chunks - add validation
    const segments = geminiChunks
      .filter(chunk => chunk.transcript && chunk.transcript.trim().length > 0)
      .map(chunk => ({
        transcript_id: transcriptId,
        video_id: videoId,
        text_content: chunk.transcript,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime
      }))

    if (segments.length === 0) {
      throw new Error('No valid transcript segments to create')
    }

    const segmentsCreated = await createTranscriptSegments(segments)
    if (!segmentsCreated) {
      throw new Error('Failed to create transcript segments')
    }

    // Create video chunks in database
    await updateVideoStatus(videoId, 'chunking')
    const chunkIds: string[] = []
    
    for (const chunk of geminiChunks) {
      const { id: chunkId, error: chunkError } = await createVideoChunk({
        video_id: videoId,
        title: chunk.title,
        description: chunk.description,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime,
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
    await generateAndStoreEmbeddingsFromChunks(videoId, geminiChunks, chunkIds)

    // Mark as completed
    await updateVideoStatus(videoId, 'completed')

  } catch (error) {
    console.error('Unified Gemini processing error:', error)
    throw error
  }
}

async function processWithTraditionalApproach(
  videoId: string,
  audioFilePath: string,
  provider: any
): Promise<void> {
  try {
    // Traditional transcription
    await updateVideoStatus(videoId, 'transcribing')
    console.log(`Starting traditional transcription with provider: ${provider.name}`)
    
    let transcriptSegments: TranscriptionSegment[]
    if (provider.transcribeFile) {
      transcriptSegments = await provider.transcribeFile(audioFilePath, {
        language: 'en',
        punctuate: true
      })
    } else {
      throw new Error('Provider does not support direct file upload')
    }
    
    if (transcriptSegments.length === 0) {
      throw new Error('No transcript generated from audio')
    }

    console.log(`Transcription completed: ${transcriptSegments.length} segments`)

    // Convert transcription segments to our processing format
    const processingSegments = transcriptSegments.map((seg: TranscriptionSegment) => ({
      text: seg.text,
      start: seg.start,
      duration: seg.end - seg.start,
      end: seg.end
    }))

    // Use existing pipeline for chunking and processing
    const video = await getVideoById(videoId)
    await processTranscriptAndCreateChunks(videoId, processingSegments, video?.file_path || '')
    
  } catch (error) {
    console.error('Traditional transcription processing error:', error)
    throw error
  }
}

async function generateAndStoreEmbeddingsFromChunks(
  videoId: string,
  geminiChunks: GeminiChunk[],
  chunkIds: string[]
): Promise<void> {
  try {
    // Prepare chunks for embedding generation
    const chunksForEmbedding = geminiChunks.map((chunk, index) => ({
      id: chunkIds[index],
      transcriptText: chunk.transcript,
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
      source: videoUrl.includes('youtube') ? 'youtube' : 'assemblyai'
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