import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConfigError,
  DEFAULT_MATCH_THRESHOLD,
  getGeminiEmbeddingModel,
  getGeminiFlashModel,
  getGroqChatModel,
  getMatchThreshold,
  DEFAULT_EMBEDDING_DIMENSIONS,
  getEmbeddingDimensions,
} from '@/lib/config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getMatchThreshold', () => {
  it('defaults to 0.5 when MATCH_THRESHOLD is unset (restores audit fix)', () => {
    expect(DEFAULT_MATCH_THRESHOLD).toBe(0.5)
    expect(getMatchThreshold()).toBe(0.5)
  })

  it('honors a valid MATCH_THRESHOLD override', () => {
    vi.stubEnv('MATCH_THRESHOLD', '0.8')
    expect(getMatchThreshold()).toBe(0.8)
  })

  it('rejects the debug value 0.10 territory: values <= 0', () => {
    vi.stubEnv('MATCH_THRESHOLD', '0')
    expect(() => getMatchThreshold()).toThrow(ConfigError)
  })

  it('rejects values >= 1 and non-numeric values', () => {
    vi.stubEnv('MATCH_THRESHOLD', '1')
    expect(() => getMatchThreshold()).toThrow(ConfigError)
    vi.stubEnv('MATCH_THRESHOLD', 'banana')
    expect(() => getMatchThreshold()).toThrow(ConfigError)
  })
})

describe('model IDs are env-configurable', () => {
  it('defaults are currently-alive models, not retired ones', () => {
    expect(getGeminiFlashModel()).toBe('gemini-2.5-flash')
    expect(getGeminiEmbeddingModel()).toBe('gemini-embedding-001')
    expect(getGroqChatModel()).toBe('llama-3.3-70b-versatile')
  })

  it('env overrides take precedence', () => {
    vi.stubEnv('GEMINI_FLASH_MODEL', 'gemini-3-flash-test')
    vi.stubEnv('GROQ_CHAT_MODEL', 'test-model-9000')
    expect(getGeminiFlashModel()).toBe('gemini-3-flash-test')
    expect(getGroqChatModel()).toBe('test-model-9000')
  })
})

describe('getEmbeddingDimensions', () => {
  it('defaults to 768 to stay pgvector-compatible', () => {
    expect(DEFAULT_EMBEDDING_DIMENSIONS).toBe(768)
    expect(getEmbeddingDimensions()).toBe(768)
  })

  it('rejects non-positive values', () => {
    vi.stubEnv('EMBEDDING_DIMENSIONS', '0')
    expect(() => getEmbeddingDimensions()).toThrow(ConfigError)
  })
})