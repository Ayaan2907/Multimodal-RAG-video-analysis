#!/usr/bin/env node
// Creates an organization (if it doesn't exist) and an API key, then prints
// the plaintext key exactly once. Only the SHA-256 hash is stored.
//
// Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Usage: node scripts/create-api-key.mjs --org "Acme Law" [--name ci] [--scopes "ingest:write,library:read"] [--rate-limit 120]

import { createClient } from '@supabase/supabase-js'

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

const orgName = argValue('--org')
if (!orgName) {
  console.error('Usage: node scripts/create-api-key.mjs --org "Org name" [--name key-name] [--scopes csv] [--rate-limit N]')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set them in env (never commit them).')
  process.exit(1)
}

const VALID_SCOPES = ['ingest:write', 'library:read', 'chat:run']
const scopesCsv = argValue('--scopes')
const scopes = scopesCsv
  ? scopesCsv.split(',').map((s) => s.trim()).filter(Boolean)
  : VALID_SCOPES
const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s))
if (invalid.length > 0) {
  console.error(`Unknown scope(s): ${invalid.join(', ')}. Valid scopes: ${VALID_SCOPES.join(', ')}`)
  process.exit(1)
}
if (scopes.length === 0) {
  console.error('A key must be granted at least one scope (otherwise it can never authenticate successfully).')
  process.exit(1)
}

const keyName = argValue('--name') || 'default'
const rateLimit = Number.parseInt(argValue('--rate-limit') || '60', 10)
if (!Number.isFinite(rateLimit) || rateLimit <= 0) {
  console.error('--rate-limit must be a positive integer (requests per minute).')
  process.exit(1)
}

const { createHash, randomBytes } = await import('node:crypto')
const plaintext = `vidrag_sk_${randomBytes(32).toString('base64url')}`
const keyHash = createHash('sha256').update(plaintext, 'utf8').digest('hex')

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let organizationId
{
  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .eq('name', orgName)
    .maybeSingle()
  if (error) {
    console.error(`Organization lookup failed: ${error.message}`)
    process.exit(1)
  }
  if (data) {
    organizationId = data.id
  } else {
    const { data: created, error: insertError } = await supabase
      .from('organizations')
      .insert({ name: orgName })
      .select('id')
      .single()
    if (insertError || !created) {
      console.error(`Organization creation failed: ${insertError?.message ?? 'unknown error'}`)
      process.exit(1)
    }
    organizationId = created.id
  }
}

const { error: keyError } = await supabase.from('api_keys').insert({
  organization_id: organizationId,
  name: keyName,
  key_hash: keyHash,
  key_display_prefix: plaintext.slice(0, 20),
  scopes,
  rate_limit_per_minute: rateLimit,
})

if (keyError) {
  console.error(`API key creation failed: ${keyError.message}`)
  process.exit(1)
}

console.log('API key created.')
console.log(`  org:    ${orgName} (${organizationId})`)
console.log(`  name:   ${keyName}`)
console.log(`  scopes: ${scopes.join(', ')}`)
console.log(`  limit:  ${rateLimit} req/min`)
console.log('')
console.log('Copy it now — it will not be shown again:')
console.log(plaintext)
