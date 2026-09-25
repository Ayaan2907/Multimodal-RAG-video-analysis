'use client'

// Browser-side API-key handling. Keys are stored in localStorage under a
// namespaced entry and attached as a Bearer token to app API calls. Keys never
// reach server code or logs; the server only ever sees the hash.

const STORAGE_KEY = 'vidrag_api_key'

export function getApiKey(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

export function saveApiKey(key: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, key.trim())
}

export function clearApiKey(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(STORAGE_KEY)
}

export class ApiKeyRequiredError extends Error {
  constructor() {
    super('API key required — add your key to use this app')
    this.name = 'ApiKeyRequiredError'
  }
}

export class ApiRequestError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

interface ApiErrorBody {
  error?: string
  code?: string
}

// Authenticated fetch for app API calls: attaches the stored key as a Bearer
// token and turns 401/403/429 error bodies into typed, user-facing errors.
export async function authedFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const key = getApiKey()
  if (!key) throw new ApiKeyRequiredError()

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${key}`)

  const response = await fetch(input, { ...init, headers })

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      // Non-JSON error body — fall back to the status text below.
    }
    const message =
      body.error ||
      (response.status === 401
        ? 'Invalid or missing API key'
        : response.status === 403
          ? 'This key does not have permission for that action'
          : 'Rate limit exceeded — try again shortly')
    throw new ApiRequestError(message, response.status, body.code)
  }

  return response
}