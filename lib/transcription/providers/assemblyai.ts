import { AssemblyAI } from 'assemblyai'
import { TranscriptionProvider, TranscriptSegment, TranscriptionOptions } from '../types'

export class AssemblyAIProvider implements TranscriptionProvider {
  name = 'assemblyai'
  private client: AssemblyAI
  
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('AssemblyAI API key is required')
    }
    
    this.client = new AssemblyAI({ 
      apiKey: apiKey 
    })
  }

  async transcribe(audioUrl: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]> {
    try {
      console.log(`Starting AssemblyAI transcription for: ${audioUrl}`)
      
      const params = {
        audio: audioUrl,
        punctuate: options?.punctuate !== false, // Default to true
        format_text: true,
        word_boost: options?.customVocabulary,
        language_code: options?.language,
        speaker_labels: options?.speakerDiarization || false,
        // Enable word-level timestamps for precise chunking
        word_timestamps: true
      }

      const transcript = await this.client.transcripts.transcribe(params)
      
      if (transcript.status === 'error') {
        throw new Error(`AssemblyAI transcription failed: ${transcript.error}`)
      }

      console.log(`AssemblyAI transcription completed. Found ${transcript.words?.length || 0} words`)
      
      // Convert word-level timestamps to our standard format
      if (transcript.words && transcript.words.length > 0) {
        return transcript.words.map(word => ({
          text: word.text,
          start: word.start / 1000, // Convert milliseconds to seconds
          end: word.end / 1000,
          confidence: word.confidence
        }))
      }

      // Fallback: if no word-level timestamps, create segments from full text
      if (transcript.text) {
        return [{
          text: transcript.text,
          start: 0,
          end: transcript.audio_duration || 0,
          confidence: transcript.confidence || 0.9
        }]
      }

      return []
    } catch (error) {
      console.error('AssemblyAI transcription error:', error)
      
      if (error instanceof Error) {
        // Handle specific AssemblyAI errors
        if (error.message.includes('403')) {
          throw new Error('AssemblyAI API key invalid or expired')
        } else if (error.message.includes('audio')) {
          throw new Error('Audio file format not supported or corrupted')
        }
      }
      
      throw new Error(`AssemblyAI transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  async transcribeFile(filePath: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]> {
    try {
      console.log(`Starting AssemblyAI file transcription for: ${filePath}`)
      
      // Upload file directly to AssemblyAI
      const uploadUrl = await this.client.files.upload(filePath)
      console.log(`File uploaded to AssemblyAI: ${uploadUrl}`)
      
      // Use the upload URL for transcription
      return this.transcribe(uploadUrl, options)
    } catch (error) {
      console.error('AssemblyAI file transcription error:', error)
      throw new Error(`AssemblyAI file transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  getSupportedFormats(): string[] {
    return [
      'mp3', 'mp4', 'wav', 'flac', 'm4a', 'ogg', 'webm', 
      'aac', 'amr', '3gp', 'wma', 'opus'
    ]
  }

  getMaxFileSize(): number {
    return 5 * 1024 * 1024 * 1024 // 5GB limit (AssemblyAI limit)
  }

  getCostPerHour(): number {
    return 0.37 // $0.37/hour as per AssemblyAI pricing
  }
} 