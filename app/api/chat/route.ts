import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateTextEmbedding } from '@/lib/ai/embeddings'
import { groq } from '@ai-sdk/groq'
import { generateText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth/request'
import { authErrorResponse, jsonError } from '@/lib/api/http'
import { getGroqChatModel, getMatchThreshold } from '@/lib/config'
import { getVideoById } from '@/lib/supabase/database'

// Define the expected structure for items returned by match_embeddings
interface MatchedEmbedding {
  id: string; // Embedding ID
  video_id: string;
  chunk_id: string;
  content_type: 'transcript' | 'visual' | 'multimodal';
  content_text: string;
  similarity: number;
  metadata?: Record<string, unknown> // Assuming metadata is a JSONB object
}

// Define the structure for a video chunk from the database
interface VideoChunk {
  id: string;
  video_id: string;
  chunk_number: number;
  title: string | null;
  description: string | null;
  start_time_seconds: number;
  end_time_seconds: number;
  duration_seconds: number;
  transcript_text: string | null;
  visual_description: string | null;
  created_at: string;
  updated_at: string;
}

// Combined structure for easier context building
interface VideoChunkWithEmbedding {
  chunk: VideoChunk;
  matchedEmbedding: MatchedEmbedding;
}

export async function POST(req: NextRequest) {
  try {
    // Every chat answer requires an authenticated key with the chat:run scope.
    const auth = await authenticateRequest(req, 'chat:run')
    if (!auth.ok) return authErrorResponse(auth)

    const { videoId, message } = await req.json()

    if (!videoId || !message) {
      return jsonError(400, 'invalid_request', 'Missing videoId or message')
    }

    // Org-scoped: foreign videos 404 — existence is not disclosed across orgs.
    const video = await getVideoById(videoId, auth.context.organizationId)
    if (!video) {
      return jsonError(404, 'video_not_found', 'Video not found')
    }

    const { embedding: queryEmbedding, error: queryEmbeddingError } = await generateTextEmbedding(message)

    if (queryEmbeddingError || !queryEmbedding || queryEmbedding.length === 0) {
      console.error('Chat API error: failed to generate query embedding')
      return jsonError(500, 'query_embedding_failed', 'Failed to understand query')
    }

    const matchThreshold = getMatchThreshold()

    const { data: matchedEmbeddingsData, error: matchError } = await supabaseAdmin.rpc('match_embeddings', {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: 5,
      filter_video_id: videoId
    });

    if (matchError) {
      console.error('Chat API error: match_embeddings RPC failed')
      return generateGenericResponse(message, videoId, `RPC error: ${matchError.message}`);
    }

    const matchedEmbeddings: MatchedEmbedding[] = matchedEmbeddingsData || [];
    let relevantChunksWithEmbeddings: VideoChunkWithEmbedding[] = [];

    if (matchedEmbeddings.length > 0) {
      const uniqueChunkIds = [...new Set(matchedEmbeddings.map(e => e.chunk_id))];

      if (uniqueChunkIds.length > 0) {
        const { data: fetchedChunksData, error: chunksError } = await supabaseAdmin
          .from('video_chunks')
          .select('*')
          .in('id', uniqueChunkIds)
          .returns<VideoChunk[]>();

        if (chunksError) {
          console.error('Chat API error: failed to fetch video chunks')
          // Proceed — context will be limited to the matched embedding text.
        } else if (fetchedChunksData && fetchedChunksData.length > 0) {
          relevantChunksWithEmbeddings = fetchedChunksData.map(chunk => {
            const bestMatchForChunk = matchedEmbeddings
              .filter(me => me.chunk_id === chunk.id)
              .sort((a, b) => b.similarity - a.similarity)[0];
            return { chunk, matchedEmbedding: bestMatchForChunk };
          }).filter(item => item.matchedEmbedding);
        }
      }
    }

    if (relevantChunksWithEmbeddings.length === 0) {
      return generateGenericResponse(message, videoId, 'No relevant segments found after processing.');
    }

    // Build the context with real newlines (the previous double-escaped "\\n"
    // strings collapsed the entire context into one literal-escape line).
    const contextParts = relevantChunksWithEmbeddings.map(item => {
      const { chunk, matchedEmbedding } = item;
      const lines = [
        `Segment (Chunk ID: ${chunk.id}):`,
        `Title: ${chunk.title || 'N/A'}`,
        `Time: ${formatTime(chunk.start_time_seconds)} - ${formatTime(chunk.end_time_seconds)}`,
        `Matched Content (${matchedEmbedding.content_type} with similarity ${matchedEmbedding.similarity.toFixed(2)}):`,
        matchedEmbedding.content_text,
      ]
      if (chunk.transcript_text && chunk.transcript_text !== matchedEmbedding.content_text) {
        lines.push(`Full Transcript for this segment:`, chunk.transcript_text)
      }
      if (chunk.visual_description && chunk.visual_description !== matchedEmbedding.content_text) {
        lines.push(`Visual Description for this segment:`, chunk.visual_description)
      }
      return lines.join('\n')
    })

    const contextString = ['Provided Video Segments:', '---', ...contextParts, '---'].join('\n')

    const systemPrompt = 'You are a helpful AI assistant. Answer the user\'s question based ONLY on the provided video segments. If the answer cannot be found in the provided segments, clearly state that. When possible, reference the time codes (e.g., "from Xs to Ys") of the video segments that support your answer.'

    const fullPrompt = `${systemPrompt}\n\n${contextString}\n\nUser Question: ${message}\n\nAssistant Answer:`

    const llmResponse = await generateText({
      model: groq(getGroqChatModel()),
      prompt: fullPrompt,
    });

    // Step 1.7: Return LLM response & sources
    return NextResponse.json({
      answer: llmResponse.text,
      sources: relevantChunksWithEmbeddings.map(item => ({
        chunkId: item.chunk.id,
        title: item.chunk.title,
        startTimeSeconds: item.chunk.start_time_seconds,
        endTimeSeconds: item.chunk.end_time_seconds,
        startTimeFormatted: formatTime(item.chunk.start_time_seconds),
        endTimeFormatted: formatTime(item.chunk.end_time_seconds),
        matchedOn: item.matchedEmbedding.content_type,
        similarity: item.matchedEmbedding.similarity,
      }))
    });

  } catch (error) {
    console.error('Chat API error:', error);
    const errorMessage = (error instanceof Error && error.message) ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper function for generic responses
async function generateGenericResponse(message: string, videoId: string, reason?: string) {
  // Reason is logged without user content; the message itself is never logged.
  console.log(`Chat API: generic response (${reason || 'unspecified'})`)

  const genericPrompt = `User is asking: "${message}" about video ID ${videoId}. No specific segments matched the query well, or there was an issue retrieving them. Provide a general, helpful response, or state that no specific information could be found in the video for this query.`;
  const llmResponse = await generateText({
    model: groq(getGroqChatModel()),
    prompt: genericPrompt,
  });
  return NextResponse.json({
    answer: llmResponse.text,
    sources: []
  });
}

// Helper function to format time from seconds to MM:SS or HH:MM:SS
function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const paddedHours = String(hours).padStart(2, '0');
    return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}
