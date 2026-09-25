import { 
  updateVideoStatus, 
  getVideoById, 
  createTranscript, 
  createTranscriptSegments,
  createVideoChunk,
  createChunkProvenance,
  setVideoContentHash,
  getTranscriptTextForChunk,
  VideoRecord,
  type ChunkProvenanceRow
} from '@/lib/supabase/database'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getVideoTranscript } from './youtube'
import { generateTopicBasedChunksWithBatching } from '@/lib/ai/gemini'
import { generateChunkEmbeddings, generateTextEmbedding, generateMultimodalEmbedding } from '@/lib/ai/embeddings'
import { getGeminiEmbeddingModel } from '@/lib/config'
import { sha256Hex } from '@/lib/evidence/hash'
import { TranscriptionFactory } from '@/lib/transcription/factory'
import { GeminiProvider, GeminiChunk } from '@/lib/transcription/providers/gemini'
// Shape of a row inserted into the embeddings table (matches the migration schema).
type EmbeddingInsertRow = {
  video_id: string
  chunk_id: string
  content_type: 'transcript' | 'visual' | 'multimodal'
  content_text: string
  embedding: number[]
  metadata?: Record<string, unknown>
}
import { TranscriptSegment as TranscriptionSegment, TranscriptionProvider } from '@/lib/transcription/types'

const CHUNK_DURATION_SECONDS = parseInt(process.env.CHUNK_DURATION_SECONDS || '60')
const EMBEDDING_BATCH_SIZE = 100;

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
    // Get video info for source information
    const video = await getVideoById(videoId)
    if (!video) {
      throw new Error('Video not found')
    }

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
    const provenanceRows: ChunkProvenanceRow[] = []
    
    for (let i = 0; i < geminiChunks.length; i++) {
      const chunk = geminiChunks[i]
      const { id: chunkId, error: chunkError } = await createVideoChunk({
        video_id: videoId,
        title: chunk.title,
        description: chunk.description,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime,
        transcript_text: chunk.transcript, // Include transcript in chunk
        topics: chunk.topics
      })

      if (chunkError || !chunkId) {
        console.error(`Failed to create chunk: ${chunkError}`)
        continue
      }

      chunkIds.push(chunkId)
      provenanceRows.push({
        chunk_id: chunkId,
        video_id: videoId,
        chunk_index: i + 1,
        start_time_seconds: chunk.startTime,
        end_time_seconds: chunk.endTime,
        source_sha256: video.content_sha256 ?? null,
        embedding_model: getGeminiEmbeddingModel(),
      })
    }

    if (chunkIds.length === 0) {
      throw new Error('No chunks created successfully')
    }

    // Chain of custody: provenance must complete or the video cannot serve
    // evidence — the manifest refuses incomplete custody (no silent fallback).
    const provenanceRecorded = await createChunkProvenance(provenanceRows)
    if (!provenanceRecorded) {
      throw new Error('Failed to record chunk provenance (chain of custody incomplete)')
    }

    // Generate embeddings (both transcript and video)
    await updateVideoStatus(videoId, 'embedding')
    await generateAndStoreEmbeddingsFromChunks(videoId, video, geminiChunks, chunkIds, provider)

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
  provider: TranscriptionProvider
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
    if (!video) {
      throw new Error('Video not found for traditional approach')
    }
    await processTranscriptAndCreateChunks(videoId, processingSegments, video.file_path || '', video)
    
  } catch (error) {
    console.error('Traditional transcription processing error:', error)
    throw error
  }
}

async function generateAndStoreEmbeddingsFromChunks(
  videoId: string,
  video: VideoRecord,
  geminiChunks: GeminiChunk[],
  chunkIds: string[],
  provider?: GeminiProvider
): Promise<void> {
  try {
    let allEmbeddingsToCreate: EmbeddingInsertRow[] = []; 

    const performBatchInsert = async (embeddingsToInsert: EmbeddingInsertRow[]) => {
      if (embeddingsToInsert.length === 0) return;
      console.log(`Attempting to batch insert ${embeddingsToInsert.length} embeddings into DB.`);
      const { error: insertError } = await supabaseAdmin.from('embeddings').insert(embeddingsToInsert);
      if (insertError) {
        console.error('Batch DB embedding insert error:', insertError);
      } else {
        console.log(`Successfully batch inserted ${embeddingsToInsert.length} embeddings into DB.`);
      }
    };

    if (provider) {
      console.log(`Generating multimodal embeddings for ${geminiChunks.length} chunks (Upload Flow)`)
      const getFrameCount = (durationSeconds: number): number => {
        const baseFrames = 1; const additionalFrames = Math.floor(durationSeconds / 30);
        return Math.min(baseFrames + additionalFrames, 5);
      }

      for (let i = 0; i < geminiChunks.length; i++) {
        const chunk = geminiChunks[i]; const chunkId = chunkIds[i];
        if (!chunkId) continue;
        console.time(`Chunk ${chunkId} embedding`);
        try {
          const transcriptEmbedding = await generateTextEmbedding(chunk.transcript);
          if (!transcriptEmbedding.error && transcriptEmbedding.embedding.length > 0) {
            allEmbeddingsToCreate.push({
              video_id: videoId, chunk_id: chunkId, content_type: 'transcript',
              content_text: chunk.transcript, embedding: transcriptEmbedding.embedding
            });
          }

          const chunkDuration = chunk.endTime - chunk.startTime;
          const frameCount = getFrameCount(chunkDuration);
          const videoSource = video.source_type === 'youtube' 
            ? { type: 'youtube' as const, url: video.source_url }
            : { type: 'upload' as const, path: video.file_path };

          if (videoSource.url || videoSource.path) {
            const videoEmbeddingResult = await provider.generateVideoEmbedding({
              source: videoSource, startTime: chunk.startTime, endTime: chunk.endTime, frameCount
            });
            allEmbeddingsToCreate.push({
              video_id: videoId, chunk_id: chunkId, content_type: 'visual',
              content_text: videoEmbeddingResult.description, embedding: videoEmbeddingResult.embedding,
              metadata: { confidence: videoEmbeddingResult.confidence, frameCount, chunkDuration }
            });

            const multimodalEmbedding = await generateMultimodalEmbedding(
              chunk.transcript, videoEmbeddingResult.description, chunk.topics
            );
            if (!multimodalEmbedding.error && multimodalEmbedding.embedding.length > 0) {
              allEmbeddingsToCreate.push({
                video_id: videoId, chunk_id: chunkId, content_type: 'multimodal',
                content_text: `Transcript: ${chunk.transcript}\n\nVisual: ${videoEmbeddingResult.description}`,
                embedding: multimodalEmbedding.embedding,
                metadata: { topics: chunk.topics, confidence: videoEmbeddingResult.confidence }
              });
            }
          } else {
            console.warn(`Skipping video embedding for chunk ${chunkId}: No valid video source`);
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          if (allEmbeddingsToCreate.length >= EMBEDDING_BATCH_SIZE) {
            await performBatchInsert(allEmbeddingsToCreate); allEmbeddingsToCreate = [];
          }
        } catch (error) {
          console.error(`Error processing embeddings for chunk ${chunkId}:`, error);
        } finally {
          console.timeEnd(`Chunk ${chunkId} embedding`);
        }
      }
    } else {
      const chunksForEmbedding = geminiChunks.map((chunk, index) => ({
        id: chunkIds[index], transcriptText: chunk.transcript,
        visualDescription: '', topics: chunk.topics
      }));
      const embeddingResults = await generateChunkEmbeddings(chunksForEmbedding);
      for (const result of embeddingResults) {
        if (result.error || result.embedding.length === 0) { continue; }
        allEmbeddingsToCreate.push({
          video_id: videoId, chunk_id: result.chunkId, content_type: result.contentType,
          content_text: chunksForEmbedding.find(c => c.id === result.chunkId)?.transcriptText || '',
          embedding: result.embedding
        });
        if (allEmbeddingsToCreate.length >= EMBEDDING_BATCH_SIZE) {
          await performBatchInsert(allEmbeddingsToCreate); allEmbeddingsToCreate = [];
        }
      }
    }
    await performBatchInsert(allEmbeddingsToCreate);
  } catch (error) {
    console.error('Overall embedding generation error (Upload Flow):', error);
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

    await processTranscriptAndCreateChunks(videoId, transcriptSegments, video.source_url || '', video)
    
  } catch (error) {
    console.error(`YouTube processing error for video ${videoId}:`, error)
    await updateVideoStatus(videoId, 'failed', error instanceof Error ? error.message : 'Unknown error')
  }
}

async function processTranscriptAndCreateChunks(
  videoId: string, 
  transcriptSegments: Array<{ text: string; start: number; duration: number; end: number }>,
  videoUrl: string,
  video: VideoRecord
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

    // Chain of custody: uploads carry a file hash from ingest; remote sources
    // (YouTube) have no stored file, so hash the transcript we hold instead.
    let sourceSha256: string | null = video.content_sha256 ?? null
    if (!sourceSha256) {
      sourceSha256 = sha256Hex(fullTranscript)
      const hashRecorded = await setVideoContentHash(videoId, sourceSha256, 'transcript')
      if (!hashRecorded) {
        throw new Error('Failed to record transcript content hash (chain of custody incomplete)')
      }
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
    const provenanceRows: ChunkProvenanceRow[] = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
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
      provenanceRows.push({
        chunk_id: chunkId,
        video_id: videoId,
        chunk_index: i + 1,
        start_time_seconds: chunk.start_time_seconds,
        end_time_seconds: chunk.end_time_seconds,
        source_sha256: sourceSha256,
        embedding_model: getGeminiEmbeddingModel(),
      })
    }

    if (chunkIds.length === 0) {
      throw new Error('No chunks created successfully')
    }

    // Chain of custody: provenance must complete or the video cannot serve
    // evidence — the manifest refuses incomplete custody (no silent fallback).
    const provenanceRecorded = await createChunkProvenance(provenanceRows)
    if (!provenanceRecorded) {
      throw new Error('Failed to record chunk provenance (chain of custody incomplete)')
    }

    // Generate embeddings (reconstruct transcript text when needed)
    await updateVideoStatus(videoId, 'embedding')
    await generateAndStoreEmbeddings(videoId, video, chunks, chunkIds)

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
  video: VideoRecord,
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
    let allEmbeddingsToCreate: EmbeddingInsertRow[] = [];

    const performBatchInsert = async (embeddingsToInsert: EmbeddingInsertRow[]) => {
      if (embeddingsToInsert.length === 0) return;
      console.log(`Attempting to batch insert ${embeddingsToInsert.length} embeddings into DB (YouTube Flow).`);
      const { error: insertError } = await supabaseAdmin.from('embeddings').insert(embeddingsToInsert);
      if (insertError) {
        console.error('Batch DB embedding insert error (YouTube Flow):', insertError);
      } else {
        console.log(`Successfully batch inserted ${embeddingsToInsert.length} embeddings into DB (YouTube Flow).`);
      }
    };

    const chunksForEmbedding = await Promise.all(
      chunks.map(async (chunk, index) => {
        const transcriptText = await getTranscriptTextForChunk(
          videoId, chunk.start_time_seconds, chunk.end_time_seconds
        );
        return { id: chunkIds[index], transcriptText, visualDescription: '', topics: chunk.topics };
      })
    );

    const canGenerateVideoEmbeddings = video.source_type === 'youtube' && video.source_url;
    const provider = canGenerateVideoEmbeddings ? TranscriptionFactory.create() : null;

    if (canGenerateVideoEmbeddings && provider instanceof GeminiProvider) {
      console.log(`Generating multimodal embeddings for YouTube video: ${video.source_url}`);
      const getFrameCount = (durationSeconds: number): number => {
        const baseFrames = 1; const additionalFrames = Math.floor(durationSeconds / 30);
        return Math.min(baseFrames + additionalFrames, 5);
      };

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]; const chunkId = chunkIds[i];
        const chunkDataForEmbedding = chunksForEmbedding[i];
        if (!chunkId || !chunkDataForEmbedding) continue;
        console.time(`Chunk ${chunkId} embedding YT`);
        try {
          const transcriptEmbedding = await generateTextEmbedding(chunkDataForEmbedding.transcriptText);
          if (!transcriptEmbedding.error && transcriptEmbedding.embedding.length > 0) {
            allEmbeddingsToCreate.push({
              video_id: videoId, chunk_id: chunkId, content_type: 'transcript',
              content_text: chunkDataForEmbedding.transcriptText, embedding: transcriptEmbedding.embedding
            });
          }

          const chunkDuration = chunk.end_time_seconds - chunk.start_time_seconds;
          const frameCount = getFrameCount(chunkDuration);
          const videoEmbeddingResult = await provider.generateVideoEmbedding({
            source: { type: 'youtube', url: video.source_url! },
            startTime: chunk.start_time_seconds, endTime: chunk.end_time_seconds, frameCount
          });
          allEmbeddingsToCreate.push({
            video_id: videoId, chunk_id: chunkId, content_type: 'visual',
            content_text: videoEmbeddingResult.description, embedding: videoEmbeddingResult.embedding,
            metadata: { confidence: videoEmbeddingResult.confidence, frameCount, chunkDuration }
          });

          const multimodalEmbedding = await generateMultimodalEmbedding(
            chunkDataForEmbedding.transcriptText, videoEmbeddingResult.description, chunk.topics
          );
          if (!multimodalEmbedding.error && multimodalEmbedding.embedding.length > 0) {
            allEmbeddingsToCreate.push({
              video_id: videoId, chunk_id: chunkId, content_type: 'multimodal',
              content_text: `Transcript: ${chunkDataForEmbedding.transcriptText}\n\nVisual: ${videoEmbeddingResult.description}`,
              embedding: multimodalEmbedding.embedding,
              metadata: { topics: chunk.topics, confidence: videoEmbeddingResult.confidence }
            });
          }
          await new Promise(resolve => setTimeout(resolve, 200));
          if (allEmbeddingsToCreate.length >= EMBEDDING_BATCH_SIZE) {
            await performBatchInsert(allEmbeddingsToCreate); allEmbeddingsToCreate = [];
          }
        } catch (error) {
          console.error(`Error processing video embeddings for chunk ${chunkId} (YouTube Flow):`, error);
        } finally {
          console.timeEnd(`Chunk ${chunkId} embedding YT`);
        }
      }
    } else {
      // Fallback: Generate only transcript embeddings (original functionality)
      const embeddingResults = await generateChunkEmbeddings(chunksForEmbedding);
      for (const result of embeddingResults) {
        if (result.error || result.embedding.length === 0) { continue; }
        allEmbeddingsToCreate.push({
          video_id: videoId, chunk_id: result.chunkId, content_type: result.contentType,
          content_text: chunksForEmbedding.find(c => c.id === result.chunkId)?.transcriptText || '',
          embedding: result.embedding
        });
        if (allEmbeddingsToCreate.length >= EMBEDDING_BATCH_SIZE) {
          await performBatchInsert(allEmbeddingsToCreate); allEmbeddingsToCreate = [];
        }
      }
    }
    // Insert any remaining embeddings
    await performBatchInsert(allEmbeddingsToCreate);

  } catch (error) {
    console.error('Overall embedding generation error (YouTube Flow):', error);
  }
}

export async function getVideoStatus(
  videoId: string,
  organizationId?: string
): Promise<{
  status: string
  error?: string
  progress?: number
} | null> {
  try {
    const video = await getVideoById(videoId, organizationId)
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