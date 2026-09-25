import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { AudioExtractionResult } from '../transcription/types'

export async function extractAudioFromVideo(
  videoPath: string,
  videoId: string
): Promise<AudioExtractionResult> {
  const tempDir = process.env.TEMP_DIR || '/tmp'
  const audioFileName = `audio_${videoId}_${Date.now()}.mp3`
  const audioPath = join(tempDir, audioFileName)

  try {
    console.log(`Extracting audio from video: ${videoPath}`)
    
    // Extract audio using FFmpeg
    await extractAudioWithFFmpeg(videoPath, audioPath)
    
    // Get audio file info
    const stats = await fs.stat(audioPath)
    const duration = await getAudioDuration(audioPath)
    
    console.log(`Audio extracted: ${audioPath} (${stats.size} bytes, ${duration}s)`)
    
    // Upload to Supabase Storage
    const audioUrl = await uploadAudioToStorage(audioPath, audioFileName)
    
    return {
      audioPath,
      audioUrl,
      duration,
      format: 'mp3',
      fileName: audioFileName // Add filename for cleanup
    }
  } catch (error) {
    // Cleanup on error
    try {
      await fs.unlink(audioPath)
    } catch (cleanupError) {
      console.warn('Failed to cleanup audio file:', cleanupError)
    }
    
    throw error
  }
}

export async function extractAudioFromVideoLocal(
  videoPath: string,
  videoId: string
): Promise<{ audioPath: string; duration: number; format: string }> {
  const tempDir = process.env.TEMP_DIR || '/tmp'
  const audioFileName = `audio_${videoId}_${Date.now()}.mp3`
  const audioPath = join(tempDir, audioFileName)

  try {
    console.log(`Extracting audio locally from video: ${videoPath}`)
    
    // Extract audio using FFmpeg
    await extractAudioWithFFmpeg(videoPath, audioPath)
    
    // Get audio file info
    const stats = await fs.stat(audioPath)
    const duration = await getAudioDuration(audioPath)
    
    console.log(`Audio extracted locally: ${audioPath} (${stats.size} bytes, ${duration}s)`)
    
    return {
      audioPath,
      duration,
      format: 'mp3'
    }
  } catch (error) {
    // Cleanup on error
    try {
      await fs.unlink(audioPath)
    } catch (cleanupError) {
      console.warn('Failed to cleanup audio file:', cleanupError)
    }
    
    throw error
  }
}

async function extractAudioWithFFmpeg(
  inputPath: string, 
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // First check if the video has an audio stream
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      inputPath
    ])

    let hasAudio = false
    
    ffprobe.stdout.on('data', (data) => {
      if (data.toString().trim() === 'audio') {
        hasAudio = true
      }
    })

    ffprobe.on('close', (code) => {
      if (code !== 0 || !hasAudio) {
        reject(new Error('Video file does not contain an audio stream. Please upload a video with audio.'))
        return
      }

      // Proceed with audio extraction
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-vn', // No video stream
        '-acodec', 'libmp3lame', // MP3 codec
        '-ar', '44100', // Sample rate
        '-ac', '2', // Stereo
        '-b:a', '192k', // Audio bitrate
        '-f', 'mp3', // Force MP3 format
        '-y', // Overwrite output file
        outputPath
      ])

      let stderr = ''

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          // Provide more specific error messages
          if (stderr.includes('no audio')) {
            reject(new Error('Video file does not contain an audio stream. Please upload a video with audio.'))
          } else if (stderr.includes('Invalid argument')) {
            reject(new Error('Invalid video file format or corrupted file.'))
          } else {
            reject(new Error(`Audio extraction failed: ${stderr}`))
          }
        }
      })

      ffmpeg.on('error', (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`))
      })
    })

    ffprobe.on('error', (error) => {
      reject(new Error(`Cannot analyze video file: ${error.message}`))
    })
  })
}

async function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      audioPath
    ])

    let stdout = ''

    ffprobe.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout)
          const duration = parseFloat(info.format.duration) || 0
          resolve(duration)
        } catch {
          resolve(0) // Default to 0 if parsing fails
        }
      } else {
        resolve(0) // Default to 0 if ffprobe fails
      }
    })

    ffprobe.on('error', () => {
      resolve(0) // Default to 0 if ffprobe errors
    })
  })
}

async function uploadAudioToStorage(
  audioPath: string, 
  fileName: string
): Promise<string> {
  try {
    // Read the audio file
    const audioBuffer = await fs.readFile(audioPath)
    
    // Upload to Supabase Storage
    const { error } = await getSupabaseAdmin().storage
      .from('audio-files')
      .upload(fileName, audioBuffer, {
        contentType: 'audio/mpeg',
        cacheControl: '3600'
      })

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`)
    }

    // Buckets are private — hand out a short-lived signed URL, not a public one.
    const { data: urlData, error: urlError } = await getSupabaseAdmin().storage
      .from('audio-files')
      .createSignedUrl(fileName, 3600)

    if (urlError || !urlData?.signedUrl) {
      throw new Error('Failed to get signed URL for uploaded audio')
    }

    return urlData.signedUrl
  } finally {
    // Cleanup local file
    try {
      await fs.unlink(audioPath)
    } catch (error) {
      console.warn(`Failed to cleanup audio file ${audioPath}:`, error)
    }
  }
}

// Function to cleanup audio file from storage after transcription
export async function cleanupAudioFile(fileName: string): Promise<void> {
  try {
    console.log(`Cleaning up audio file from storage: ${fileName}`)
    
    const { error } = await getSupabaseAdmin().storage
      .from('audio-files')
      .remove([fileName])

    if (error) {
      console.error(`Failed to delete audio file ${fileName}:`, error)
      // Don't throw - this is cleanup, not critical
    } else {
      console.log(`Successfully deleted audio file: ${fileName}`)
    }
  } catch (error) {
    console.error(`Error during audio file cleanup ${fileName}:`, error)
    // Don't throw - this is cleanup, not critical
  }
}

export async function checkFFmpegAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version'])
    
    ffmpeg.on('close', (code) => {
      resolve(code === 0)
    })
    
    ffmpeg.on('error', () => {
      resolve(false)
    })
  })
}
