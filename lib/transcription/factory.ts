import { GeminiProvider } from './providers/gemini'
import { AssemblyAIProvider } from './providers/assemblyai'
import { TranscriptionProvider } from './types'
import { getAssemblyAiApiKey, getGeminiApiKey } from '@/lib/config'

// Provider registry. API keys come from env at call time (never module scope,
// never hardcoded) so a missing provider config is a clean runtime error, not
// a boot-time crash.

export function getProvider(name: string): TranscriptionProvider | null {
  switch (name.toLowerCase()) {
    case 'gemini':
      return new GeminiProvider(getGeminiApiKey())
    case 'assemblyai':
      return new AssemblyAIProvider(getAssemblyAiApiKey())
    default:
      return null
  }
}

export function getAllProviders(): TranscriptionProvider[] {
  const providers: TranscriptionProvider[] = []
  for (const name of ['gemini', 'assemblyai']) {
    try {
      const provider = getProvider(name)
      if (provider) providers.push(provider)
    } catch (error) {
      // Skip providers whose credentials are not configured.
      console.warn(`Provider ${name} unavailable:`, error instanceof Error ? error.message : error)
    }
  }
  return providers
}

// Backwards-compatible surface used by lib/video/processing.ts.
export const TranscriptionFactory = {
  create(providerName?: string): TranscriptionProvider {
    const name = providerName || process.env.TRANSCRIPTION_PROVIDER || 'gemini'
    const provider = getProvider(name)
    if (!provider) {
      throw new Error(
        `Transcription provider '${name}' not found. Available providers: gemini, assemblyai`
      )
    }
    return provider
  },

  getAvailableProviders(): string[] {
    return ['gemini', 'assemblyai']
  },

  isProviderAvailable(name: string): boolean {
    return ['gemini', 'assemblyai'].includes(name.toLowerCase())
  },
}
