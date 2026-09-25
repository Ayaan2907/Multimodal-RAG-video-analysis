import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from '@/lib/webhooks/signature'

// Central environment configuration.
//
// Rules enforced here (spec art_HKWx4t5y §1):
// - Secrets are read from env only; there is no code fallback anywhere.
// - Model IDs are env-configurable with sane, currently-alive defaults —
//   vendor-retired models must never be hardcoded again (audit §5).
// - Accessors are functions, not module-scope constants, so importing a module
//   never crashes at evaluation time when env vars are absent (audit §6.3).

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value || !value.trim()) {
    throw new ConfigError(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : undefined
}

export interface SupabaseConfig {
  url: string
  anonKey: string
  serviceRoleKey: string
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: required('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  }
}

export function getGeminiApiKey(): string {
  return required('GOOGLE_GENERATIVE_AI_API_KEY')
}

export function getGroqApiKey(): string {
  return required('GROQ_API_KEY')
}

export function getAssemblyAiApiKey(): string {
  return required('ASSEMBLYAI_API_KEY')
}

export function getYoutubeApiKey(): string | undefined {
  return optional('YOUTUBE_API_KEY')
}

// ---- Model IDs (env-configurable, alive defaults) ----

export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash'
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'
export const DEFAULT_GROQ_CHAT_MODEL = 'llama-3.3-70b-versatile'

export function getGeminiFlashModel(): string {
  return optional('GEMINI_FLASH_MODEL') ?? DEFAULT_GEMINI_FLASH_MODEL
}

export function getGeminiEmbeddingModel(): string {
  return optional('GEMINI_EMBEDDING_MODEL') ?? DEFAULT_GEMINI_EMBEDDING_MODEL
}

export function getGroqChatModel(): string {
  return optional('GROQ_CHAT_MODEL') ?? DEFAULT_GROQ_CHAT_MODEL
}

// ---- Retrieval / pipeline tuning ----

export const DEFAULT_MATCH_THRESHOLD = 0.5

export function getMatchThreshold(): number {
  const raw = optional('MATCH_THRESHOLD')
  if (raw === undefined) return DEFAULT_MATCH_THRESHOLD
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new ConfigError(`MATCH_THRESHOLD must be a number strictly between 0 and 1, got: ${raw}`)
  }
  return value
}

// gemini-embedding-001 honors `outputDimensionality`; 768 keeps the pgvector
// column and the match_embeddings RPC compatible with the original schema.
export const DEFAULT_EMBEDDING_DIMENSIONS = 768

export function getEmbeddingDimensions(): number {
  const raw = optional('EMBEDDING_DIMENSIONS')
  if (raw === undefined) return DEFAULT_EMBEDDING_DIMENSIONS
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`EMBEDDING_DIMENSIONS must be a positive integer, got: ${raw}`)
  }
  return value
}

// ---- Webhooks (API v1) ----

export function getWebhookToleranceSeconds(): number {
  const raw = optional('WEBHOOK_TOLERANCE_SECONDS')
  if (raw === undefined) return DEFAULT_WEBHOOK_TOLERANCE_SECONDS
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new ConfigError(`WEBHOOK_TOLERANCE_SECONDS must be a positive number, got: ${raw}`)
  }
  return value
}
