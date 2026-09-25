import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { hashApiKey, isValidApiKeyFormat, parseBearerToken, type ApiKeyScope } from './api-keys'
import { checkRateLimit } from './rate-limit'

// Request authentication guard for every /api route.
// 401 = no/bad/unknown/revoked key. 403 = key lacks the required scope.
// 429 = per-key rate limit exhausted. 500 = auth lookup failed (never
// fail-open: a database error during key lookup is a typed error, not access).

export interface AuthContext {
  organizationId: string
  keyId: string
  scopes: ApiKeyScope[]
}

export type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; status: 401 | 403 | 429 | 500; code: string; message: string }

interface ApiKeyRow {
  id: string
  organization_id: string
  scopes: string[] | null
  rate_limit_per_minute: number | null
  revoked_at: string | null
}

export async function authenticateRequest(
  request: Request,
  requiredScope: ApiKeyScope,
): Promise<AuthResult> {
  const token = parseBearerToken(request.headers.get('authorization'))
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: 'missing_api_key',
      message: 'Authorization header with a Bearer API key is required (vidrag_sk_…)',
    }
  }

  if (!isValidApiKeyFormat(token)) {
    return {
      ok: false,
      status: 401,
      code: 'malformed_api_key',
      message: 'API key format is invalid. Keys look like vidrag_sk_<secret>.',
    }
  }

  const keyHash = hashApiKey(token)
  const { data: keyRow, error } = await getSupabaseAdmin()
    .from('api_keys')
    .select('id, organization_id, scopes, rate_limit_per_minute, revoked_at')
    .eq('key_hash', keyHash)
    .maybeSingle<ApiKeyRow>()

  if (error) {
    return {
      ok: false,
      status: 500,
      code: 'auth_lookup_failed',
      message: 'API key lookup failed',
    }
  }

  if (!keyRow) {
    return {
      ok: false,
      status: 401,
      code: 'unknown_api_key',
      message: 'API key not recognized',
    }
  }

  if (keyRow.revoked_at) {
    return {
      ok: false,
      status: 401,
      code: 'revoked_api_key',
      message: 'API key has been revoked',
    }
  }

  const limit = checkRateLimit(keyRow.id, keyRow.rate_limit_per_minute ?? 60)
  if (!limit.allowed) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limit_exceeded',
      message: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds} seconds.`,
    }
  }

  const grantedScopes = keyRow.scopes ?? []
  if (!grantedScopes.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      code: 'scope_not_granted',
      message: `API key is not authorized for scope '${requiredScope}'. Granted scopes: ${
        grantedScopes.length > 0 ? grantedScopes.join(', ') : 'none'
      }.`,
    }
  }

  void touchLastUsed(keyRow.id)

  return {
    ok: true,
    context: {
      organizationId: keyRow.organization_id,
      keyId: keyRow.id,
      scopes: grantedScopes as ApiKeyScope[],
    },
  }
}

async function touchLastUsed(keyId: string): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId)
  } catch (error) {
    // Telemetry only — must not fail the request.
    console.warn('Failed to update api key last_used_at:', error)
  }
}
