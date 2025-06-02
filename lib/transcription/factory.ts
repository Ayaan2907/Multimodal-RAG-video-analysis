import { TranscriptionProvider } from './types'
import { AssemblyAIProvider } from './providers/assemblyai'
import { GeminiProvider } from './providers/gemini'

export class TranscriptionFactory {
  private static providers = new Map<string, () => TranscriptionProvider>()
  private static initialized = false

  private static initialize() {
    if (this.initialized) return

    // Register Gemini provider (primary)
    this.register('gemini', () => {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      if (!apiKey) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY environment variable is required for Gemini transcription')
      }
      return new GeminiProvider(apiKey)
    })

    // Register AssemblyAI provider (fallback)
    this.register('assemblyai', () => {
      const apiKey = process.env.ASSEMBLYAI_API_KEY
      if (!apiKey) {
        throw new Error('ASSEMBLYAI_API_KEY environment variable is required')
      }
      return new AssemblyAIProvider(apiKey)
    })

    // Future providers can be registered here
    // this.register('openai-whisper', () => new OpenAIWhisperProvider(process.env.OPENAI_API_KEY!))
    // this.register('google-speech', () => new GoogleSpeechProvider(process.env.GOOGLE_API_KEY!))

    this.initialized = true
  }

  static register(name: string, factory: () => TranscriptionProvider) {
    this.providers.set(name, factory)
  }

  static create(providerName?: string): TranscriptionProvider {
    this.initialize()
    
    const name = providerName || process.env.TRANSCRIPTION_PROVIDER || 'gemini'
    const factory = this.providers.get(name)
    
    if (!factory) {
      const availableProviders = Array.from(this.providers.keys()).join(', ')
      throw new Error(`Transcription provider '${name}' not found. Available providers: ${availableProviders}`)
    }
    
    try {
      return factory()
    } catch (error) {
      console.error(`Failed to create transcription provider '${name}':`, error)
      throw error
    }
  }

  static getAvailableProviders(): string[] {
    this.initialize()
    return Array.from(this.providers.keys())
  }

  static isProviderAvailable(name: string): boolean {
    this.initialize()
    return this.providers.has(name)
  }
} 