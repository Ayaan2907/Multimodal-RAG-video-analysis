// Note: This is a server-side implementation
// The youtube-transcript-api would need to be implemented as a separate service
// or use a different approach for production

export interface YouTubeVideoInfo {
  id: string
  title: string
  description: string
  duration: number
  thumbnailUrl: string
  channelTitle: string
}

export interface TranscriptSegment {
  text: string
  start: number
  duration: number
  end: number
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&\n?#]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^&\n?#]+)/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([^&\n?#]+)/,
    /(?:https?:\/\/)?youtu\.be\/([^&\n?#]+)/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }

  return null
}

export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null
}

export async function getVideoInfo(videoId: string): Promise<YouTubeVideoInfo | null> {
  try {
    // This would typically use YouTube Data API v3
    // For now, we'll return mock data
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${process.env.YOUTUBE_API_KEY}&part=snippet,contentDetails`,
      { method: 'GET' }
    )

    if (!response.ok) {
      console.error('YouTube API error:', response.status)
      return null
    }

    const data = await response.json()
    
    if (!data.items || data.items.length === 0) {
      return null
    }

    const video = data.items[0]
    const snippet = video.snippet
    const contentDetails = video.contentDetails

    // Parse duration from ISO 8601 format (PT4M13S -> 253 seconds)
    const duration = parseDuration(contentDetails.duration)

    return {
      id: videoId,
      title: snippet.title,
      description: snippet.description,
      duration,
      thumbnailUrl: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || '',
      channelTitle: snippet.channelTitle
    }
  } catch (error) {
    console.error('Error fetching video info:', error)
    return null
  }
}

export async function getVideoTranscript(videoId: string): Promise<TranscriptSegment[]> {
  try {
    // This would use youtube-transcript-api or similar
    // For production, you'd implement this as a separate service
    
    // Mock implementation - replace with actual transcript fetching
    const mockTranscript: TranscriptSegment[] = [
      { text: 'Welcome to this video tutorial', start: 0, duration: 3, end: 3 },
      { text: 'Today we will be learning about', start: 3, duration: 4, end: 7 },
      { text: 'advanced video processing techniques', start: 7, duration: 5, end: 12 },
      // ... more segments
    ]

    return mockTranscript

    // Actual implementation would look like:
    /*
    const { YoutubeTranscript } = await import('youtube-transcript')
    const transcript = await YoutubeTranscript.fetchTranscript(videoId)
    
    return transcript.map(item => ({
      text: item.text,
      start: item.offset / 1000, // Convert to seconds
      duration: item.duration / 1000,
      end: (item.offset + item.duration) / 1000
    }))
    */
  } catch (error) {
    console.error('Error fetching transcript:', error)
    return []
  }
}

export async function downloadVideo(videoId: string): Promise<{ filePath: string; error?: string }> {
  try {
    // This would use yt-dlp or similar tool
    // For now, return a mock file path
    
    // In production, you'd implement something like:
    /*
    const outputPath = `/tmp/video_${videoId}.mp4`
    
    // Use yt-dlp to download video
    const command = `yt-dlp -f "best[height<=720]" -o "${outputPath}" "https://youtube.com/watch?v=${videoId}"`
    await execAsync(command)
    
    return { filePath: outputPath }
    */

    return { filePath: `/mock/path/video_${videoId}.mp4` }
  } catch (error) {
    console.error('Error downloading video:', error)
    return {
      filePath: '',
      error: error instanceof Error ? error.message : 'Download failed'
    }
  }
}

function parseDuration(duration: string): number {
  // Parse ISO 8601 duration format (PT4M13S -> 253 seconds)
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  
  if (!match) return 0
  
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  
  return hours * 3600 + minutes * 60 + seconds
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function createYouTubeUrl(videoId: string, startTime?: number): string {
  const baseUrl = `https://www.youtube.com/watch?v=${videoId}`
  return startTime ? `${baseUrl}&t=${Math.floor(startTime)}s` : baseUrl
} 