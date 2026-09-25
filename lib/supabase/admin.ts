import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from '@/lib/config'

// Server-side client with elevated privileges (bypasses RLS).
//
// Security history: this file used to fall back to a committed service-role
// JWT when env vars were absent (audit §6.1). The key has been rotated by the
// owner; the fallback is gone for good — credentials come from env only.

let cachedClient: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (!cachedClient) {
    const { url, serviceRoleKey } = getSupabaseConfig()
    cachedClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }
  return cachedClient
}

// Compatibility export: same import surface as the old eagerly-created
// constant, but the env vars are only read (and errors only thrown) the first
// time the client is actually used — never at module-evaluation time.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin()
    const value = Reflect.get(client, prop, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
