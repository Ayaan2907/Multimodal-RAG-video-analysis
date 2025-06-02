export interface TranscriptSegment {
  text: string
  start: number
  end: number
  confidence?: number
}

export interface TranscriptionOptions {
  language?: string
  model?: string
  punctuate?: boolean
  speakerDiarization?: boolean
  customVocabulary?: string[]
}

export interface TranscriptionProvider {
  name: string
  transcribe(audioUrl: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]>
  transcribeFile?(filePath: string, options?: TranscriptionOptions): Promise<TranscriptSegment[]>
  getSupportedFormats(): string[]
  getMaxFileSize(): number
  getCostPerHour(): number
}

export interface TranscriptionResult {
  segments: TranscriptSegment[]
  provider: string
  cost: number
  duration: number
  processingTime: number
}

export interface AudioExtractionResult {
  audioPath: string
  audioUrl: string
  duration: number
  format: string
  fileName: string
} 