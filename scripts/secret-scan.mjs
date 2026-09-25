#!/usr/bin/env node
// Secret scan over the working tree (tracked files only).
//
// Why not gitleaks over git history: the repo's history contains a Supabase
// service-role key that the owner has already rotated — a history scan fails
// forever on that known, dead credential. The actionable CI gate is "no live
// secret in the current tree", which is what this checks. History scrubbing is
// a separate, human decision.
//
// Usage: node scripts/secret-scan.mjs   (exit 1 on findings)

import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.sql',
  '.yml', '.yaml', '.toml', '.html', '.css', '.env.example', '',
])
const MAX_FILE_BYTES = 1024 * 1024
const ALLOWED_FILES = new Set(['bun.lock', 'package-lock.json', 'pnpm-lock.yaml'])

// The scanner's own source embeds the tripwire literals it matches, so it must
// exclude itself from the scan.
const SELF_PATH = relative(process.cwd(), fileURLToPath(import.meta.url))

// High-signal credential patterns. Snippets are never printed in full.
const PATTERNS = [
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // The previously leaked Supabase project ref — tripwire against regression.
  { name: 'leaked-supabase-project-ref', regex: /iqqmthqteucwhenejxsr/ },
  { name: 'provider-api-key', regex: /\b(?:sk|gsk|rk)-[A-Za-z0-9]{16,}\b/ },
  {
    name: 'hardcoded-secret-assignment',
    regex: /(api[_-]?key|secret|password|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{16,}["']/i,
  },
]

let trackedFiles
try {
  trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
} catch (error) {
  console.error('secret-scan must run inside a git checkout:', error.message)
  process.exit(1)
}

const findings = []

for (const file of trackedFiles) {
  if (file === SELF_PATH) continue
  if (ALLOWED_FILES.has(file)) continue
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  if (!TEXT_EXTENSIONS.has(ext)) continue

  let size
  try {
    size = statSync(file).size
  } catch {
    continue // deleted between ls-files and stat
  }
  if (size > MAX_FILE_BYTES) continue

  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const { name, regex } of PATTERNS) {
      if (regex.test(lines[i])) {
        findings.push({ file, line: i + 1, name, snippet: `${lines[i].trim().slice(0, 8)}…` })
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan FAILED — potential credentials in tracked files:')
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]  ${f.snippet}`)
  }
  process.exit(1)
}

console.log(`Secret scan passed (${trackedFiles.length} tracked files checked).`)
