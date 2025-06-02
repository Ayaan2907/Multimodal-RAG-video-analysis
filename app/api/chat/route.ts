import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateTextEmbedding } from '@/lib/ai/embeddings';
import { groq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import { NextRequest, NextResponse } from 'next/server';

// Define the expected structure for items returned by match_embeddings
interface MatchedEmbedding {
  id: string; // Embedding ID
  video_id: string;
  chunk_id: string;
  content_type: 'transcript' | 'visual' | 'multimodal';
  content_text: string;
  similarity: number;
  metadata?: Record<string, any>; // Assuming metadata is a JSONB object
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
  visual_description: string | null; // Assuming you added this column
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
    const { videoId, message, // TODO: Add chatHistory later
    } = await req.json();

    console.log(`CHAT API DEBUG: Received request for videoId: ${videoId}, message: "${message}"`);

    if (!videoId || !message) {
      console.error('CHAT API ERROR: Missing videoId or message');
      return NextResponse.json({ error: 'Missing videoId or message' }, { status: 400 });
    }
    
    if (!process.env.GROQ_API_KEY) {
      console.error('CHAT API ERROR: GROQ_API_KEY is not set.');
      return NextResponse.json({ error: 'AI service not configured: Missing GROQ_API_KEY' }, { status: 500 });
    }

    const { embedding: queryEmbedding, error: queryEmbeddingError } = await generateTextEmbedding(message);

    if (queryEmbeddingError || !queryEmbedding || queryEmbedding.length === 0) {
      console.error('CHAT API ERROR: Error generating query embedding:', queryEmbeddingError);
      return NextResponse.json({ error: 'Failed to understand query' }, { status: 500 });
    }
    console.log(`CHAT API DEBUG: Query embedding generated. First 3 values: ${queryEmbedding.slice(0,3).join(', ')}`);

    // Temporarily lower threshold for debugging - REMEMBER TO CHANGE BACK
    const matchThreshold = 0.10; 
    console.log(`CHAT API DEBUG: Using match_threshold: ${matchThreshold}`);

    const { data: matchedEmbeddingsData, error: matchError } = await supabaseAdmin.rpc('match_embeddings', {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold, 
      match_count: 5,        
      filter_video_id: videoId
    });

    console.log('CHAT API DEBUG: Result from match_embeddings RPC:');
    console.log('CHAT API DEBUG: matchError:', JSON.stringify(matchError, null, 2));
    console.log('CHAT API DEBUG: matchedEmbeddingsData:', JSON.stringify(matchedEmbeddingsData, null, 2));

    if (matchError) {
      console.error('CHAT API ERROR: Error from match_embeddings RPC:', matchError);
      return generateGenericResponse(message, videoId, `RPC error: ${matchError.message}`);
    }

    const matchedEmbeddings: MatchedEmbedding[] = matchedEmbeddingsData || [];
    let relevantChunksWithEmbeddings: VideoChunkWithEmbedding[] = [];

    if (matchedEmbeddings.length > 0) {
      const uniqueChunkIds = [...new Set(matchedEmbeddings.map(e => e.chunk_id))];
      console.log('CHAT API DEBUG: Unique chunk IDs from matched embeddings:', uniqueChunkIds);

      if (uniqueChunkIds.length === 0) {
         console.log('CHAT API DEBUG: No unique chunk IDs found after matching embeddings.');
      } else {
        const { data: fetchedChunksData, error: chunksError } = await supabaseAdmin
          .from('video_chunks')
          .select('*')
          .in('id', uniqueChunkIds)
          .returns<VideoChunk[]>();

        console.log('CHAT API DEBUG: Result from fetching video_chunks:');
        console.log('CHAT API DEBUG: chunksError:', JSON.stringify(chunksError, null, 2));
        console.log('CHAT API DEBUG: fetchedChunksData:', JSON.stringify(fetchedChunksData, null, 2));

        if (chunksError) {
          console.error('CHAT API ERROR: Error fetching video chunks:', chunksError);
          // Proceed, but log that context will be limited.
          console.log('CHAT API DEBUG: Proceeding without full chunk details due to fetch error.');
        } else if (fetchedChunksData && fetchedChunksData.length > 0) {
          relevantChunksWithEmbeddings = fetchedChunksData.map(chunk => {
            const bestMatchForChunk = matchedEmbeddings
              .filter(me => me.chunk_id === chunk.id)
              .sort((a, b) => b.similarity - a.similarity)[0];
            return { chunk, matchedEmbedding: bestMatchForChunk };
          }).filter(item => item.matchedEmbedding); 
        } else {
          console.log('CHAT API DEBUG: No data returned from video_chunks for the given IDs, or fetchedChunksData was empty.');
        }
      }
    } else {
      console.log('CHAT API DEBUG: matchedEmbeddings array was empty after RPC call.');
    }
    
    console.log('CHAT API DEBUG: Final relevantChunksWithEmbeddings count:', relevantChunksWithEmbeddings.length);
    // console.log('CHAT API DEBUG: Final relevantChunksWithEmbeddings content:', JSON.stringify(relevantChunksWithEmbeddings, null, 2));

    if (relevantChunksWithEmbeddings.length === 0) {
      console.log('CHAT API DEBUG: No relevant chunks with embeddings found to build context. Generating generic response.');
      return generateGenericResponse(message, videoId, 'No relevant segments found after processing.');
    }

    let contextString = 'Provided Video Segments:\\n---\\n';
    for (const item of relevantChunksWithEmbeddings) {
      const { chunk, matchedEmbedding } = item;
      contextString += `Segment (Chunk ID: ${chunk.id}):\\n`;
      contextString += `Title: ${chunk.title || 'N/A'}\\n`;
      contextString += `Time: ${formatTime(chunk.start_time_seconds)} - ${formatTime(chunk.end_time_seconds)}\\n`;
      contextString += `Matched Content (${matchedEmbedding.content_type} with similarity ${matchedEmbedding.similarity.toFixed(2)}):\\n${matchedEmbedding.content_text}\\n`;
      if (chunk.transcript_text && chunk.transcript_text !== matchedEmbedding.content_text) {
        contextString += `Full Transcript for this segment:\\n${chunk.transcript_text}\\n`;
      }
      if (chunk.visual_description && chunk.visual_description !== matchedEmbedding.content_text) {
        contextString += `Visual Description for this segment:\\n${chunk.visual_description}\\n`;
      }
      contextString += '---\\n';
    }

    // Step 1.6: Call for chat completion
    const systemPrompt = "You are a helpful AI assistant. Answer the user's question based ONLY on the provided video segments. If the answer cannot be found in the provided segments, clearly state that. When possible, reference the time codes (e.g., \\\"from Xs to Ys\\\") of the video segments that support your answer.";
    
    const fullPrompt = `${systemPrompt}\\n\\n${contextString}\\nUser Question: ${message}\\n\\nAssistant Answer:`;

    console.log('Prompting LLM with context. Length:', contextString.length);

    const llmResponse = await generateText({
      model: groq('llama3-70b-8192'),
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
        // Optionally, include the matched text snippet for display in UI
        // matchedText: item.matchedEmbedding.content_text 
      }))
    });

  } catch (error) {
    console.error('Chat API error:', error);
    // Check if error is an object and has a message property
    const errorMessage = (error instanceof Error && error.message) ? error.message : 'Internal server error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper function for generic responses
async function generateGenericResponse(message: string, videoId: string, reason?: string) {
  console.log(`CHAT API DEBUG: Generating generic response for videoId: ${videoId}, message: "${message}", Reason: ${reason || 'Not specified'}`);
  // Ensure Groq API key is set for generic responses as well
  if (!process.env.GROQ_API_KEY) {
    console.error('GROQ_API_KEY is not set in environment variables for generic response.');
    // Avoid returning the key error directly to client for generic fallback
    return NextResponse.json({
      answer: "I'm currently unable to process this request due to a configuration issue.",
      sources: []
    });
  }

  const genericPrompt = `User is asking: \\\"${message}\\\" about video ID ${videoId}. No specific segments matched the query well, or there was an issue retrieving them. Provide a general, helpful response, or state that no specific information could be found in the video for this query.`;
  const llmResponse = await generateText({
    model: groq('llama3-70b-8192'),
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