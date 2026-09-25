import { createHash, randomBytes } from 'node:crypto'

// API key material. Keys look like `vidrag_sk_<43 base64url chars>` (32 random
// bytes). Only the SHA-256 hash is ever stored; the plaintext key is shown once
// at creation (scripts/create-api-key.mjs) and cannot be recovered from the DB.

export const API_KEY_PREFIX = 'vidrag_sk'
export const KEY_DISPLAY_PREFIX_LENGTH = 20

export type ApiKeyScope = 'ingest:write' | 'library:read' | 'chat:run'

export const API_KEY_SCOPES: readonly ApiKeyScope[] = ['ingest:write', 'library:read', 'chat:run'] as const

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value)
}

export interface GeneratedApiKey {
  /** Plaintext key — shown exactly once at creation time. */
  key: string
  /** SHA-256 hex digest, the only form persisted. */
  keyHash: string
  /** Short display prefix (safe to log/show in UI lists). */
  keyDisplayPrefix: string
  scopes: ApiKeyScope[]
}

export function generateApiKey(scopes: ApiKeyScope[] = [...API_KEY_SCOPES]): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}_${randomBytes(32).toString('base64url')}`
  return {
    key,
    keyHash: hashApiKey(key),
    keyDisplayPrefix: key.slice(0, KEY_DISPLAY_PREFIX_LENGTH),
    scopes: [...scopes],
  }
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex')
}

// 32 bytes -> exactly 43 base64url characters.
const API_KEY_PATTERN = /^vidrag_sk_[A-Za-z0-9_-]{43}$/

export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_PATTERN.test(key)
}

export function parseBearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}
