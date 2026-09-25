import { describe, expect, it } from 'vitest'
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  isApiKeyScope,
  parseBearerToken,
} from '@/lib/auth/api-keys'

describe('generateApiKey', () => {
  it('produces a vidrag_sk_-prefixed key', () => {
    const { key } = generateApiKey()
    expect(key.startsWith(`${API_KEY_PREFIX}_`)).toBe(true)
  })

  it('produces 32 random bytes as base64url (43 chars)', () => {
    const { key } = generateApiKey()
    expect(key.length).toBe('vidrag_sk_'.length + 43)
    expect(isValidApiKeyFormat(key)).toBe(true)
  })

  it('hashes to sha256 hex and never returns the plaintext from the hash', () => {
    const { key, keyHash } = generateApiKey()
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(keyHash).not.toContain(key)
    expect(hashApiKey(key)).toBe(keyHash)
  })

  it('generates unique keys and hashes', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.key).not.toBe(b.key)
    expect(a.keyHash).not.toBe(b.keyHash)
  })

  it('defaults to all scopes and honors explicit scope lists', () => {
    expect(generateApiKey().scopes).toEqual(['ingest:write', 'library:read', 'chat:run'])
    expect(generateApiKey(['library:read']).scopes).toEqual(['library:read'])
  })
})

describe('hashApiKey determinism', () => {
  it('is deterministic for the same input', () => {
    expect(hashApiKey('vidrag_sk_test')).toBe(hashApiKey('vidrag_sk_test'))
  })

  it('differs for different inputs', () => {
    expect(hashApiKey('vidrag_sk_a')).not.toBe(hashApiKey('vidrag_sk_b'))
  })
})

describe('isValidApiKeyFormat', () => {
  it('accepts well-formed keys', () => {
    expect(isValidApiKeyFormat(`vidrag_sk_${'A'.repeat(43)}`)).toBe(true)
    expect(isValidApiKeyFormat(`vidrag_sk_${'aZ9-_'.repeat(9).slice(0, 43)}`)).toBe(true)
  })

  it('rejects malformed keys', () => {
    expect(isValidApiKeyFormat('')).toBe(false)
    expect(isValidApiKeyFormat('sk_live_abc')).toBe(false)
    expect(isValidApiKeyFormat(`vidrag_sk_${'A'.repeat(42)}`)).toBe(false)
    expect(isValidApiKeyFormat(`vidrag_sk_${'A'.repeat(44)}`)).toBe(false)
    expect(isValidApiKeyFormat(`vidrag_sk_${'!'.repeat(43)}`)).toBe(false)
  })
})

describe('isApiKeyScope', () => {
  it('accepts exactly the three defined scopes', () => {
    expect(isApiKeyScope('ingest:write')).toBe(true)
    expect(isApiKeyScope('library:read')).toBe(true)
    expect(isApiKeyScope('chat:run')).toBe(true)
  })

  it('rejects unknown scopes', () => {
    expect(isApiKeyScope('admin:all')).toBe(false)
    expect(isApiKeyScope('')).toBe(false)
    expect(isApiKeyScope('INGEST:WRITE')).toBe(false)
  })
})

describe('parseBearerToken', () => {
  it('parses standard bearer headers', () => {
    expect(parseBearerToken('Bearer vidrag_sk_abc')).toBe('vidrag_sk_abc')
  })

  it('is case-insensitive on the scheme and trims whitespace', () => {
    expect(parseBearerToken('bearer  vidrag_sk_abc ')).toBe('vidrag_sk_abc')
  })

  it('returns null for missing or non-bearer headers', () => {
    expect(parseBearerToken(null)).toBeNull()
    expect(parseBearerToken('')).toBeNull()
    expect(parseBearerToken('Basic dXNlcjpwYXNz')).toBeNull()
  })
})