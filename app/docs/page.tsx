import Link from 'next/link'
import { ApiKeyBanner } from '@/components/api-key-banner'
import { Button } from '@/components/ui/button'

// Docs page — API v1 contract, quickstart, webhooks, MCP config, and the
// deployment env-var manifest (spec art_HKWx4t5y §7). Everything documented
// here mirrors the implemented routes under app/api/v1/**; keep the two in
// sync when the surface changes.

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t py-10 first:border-t-0 first:pt-0">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-sm text-muted-foreground">{children}</div>
    </section>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/60 p-4 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  )
}

const endpoints: Array<{ method: string; path: string; scope: string; what: string }> = [
  {
    method: 'POST',
    path: '/api/v1/ingest',
    scope: 'ingest:write',
    what: 'Queue a video (multipart file or JSON YouTube source). Answers 202 immediately; Idempotency-Key honored.',
  },
  {
    method: 'GET',
    path: '/api/v1/videos/{id}/status',
    scope: 'library:read',
    what: 'Processing status: uploading | processing | chunking | transcribing | embedding | completed | failed, with progress 0–100.',
  },
  {
    method: 'GET',
    path: '/api/v1/videos/{id}/transcript',
    scope: 'library:read',
    what: 'Transcript export. ?format=json | srt | vtt | md (default json); ?download=1 sets an attachment filename.',
  },
  {
    method: 'POST',
    path: '/api/v1/videos/{id}/chat',
    scope: 'chat:run',
    what: 'Ask one video a question. {message, stream?} → {answer, sources}; stream:true answers with SSE events.',
  },
  {
    method: 'POST',
    path: '/api/v1/search',
    scope: 'chat:run',
    what: 'Ranked semantic search across the organization’s library, org-scoped server-side.',
  },
  {
    method: 'GET',
    path: '/api/v1/videos/{id}/manifest',
    scope: 'library:read',
    what: 'Chain-of-custody manifest: content SHA-256 + per-chunk provenance.',
  },
  {
    method: 'GET',
    path: '/api/v1/videos/{id}/export/skill.md',
    scope: 'library:read',
    what: 'SKILL.md package as a zip: SKILL.md + references/transcript.md + references/chunks.jsonl.',
  },
]

const envVars: Array<{ name: string; when: string; required: string; purpose: string }> = [
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    when: 'build + runtime',
    required: 'yes',
    purpose: 'Supabase project URL.',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    when: 'build + runtime',
    required: 'yes',
    purpose: 'Supabase anon key for the browser client. Next.js inlines NEXT_PUBLIC_* at build time — set before the first build.',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    when: 'runtime',
    required: 'yes',
    purpose: 'Server-only service role key (bypasses RLS). Must be the rotated key — never a key that was ever committed.',
  },
  {
    name: 'GOOGLE_GENERATIVE_AI_API_KEY',
    when: 'runtime',
    required: 'yes',
    purpose: 'Gemini: transcription, embeddings, video analysis.',
  },
  {
    name: 'GROQ_API_KEY',
    when: 'runtime',
    required: 'for chat',
    purpose: 'Groq chat completions (llama default). Required for chat/search surfaces.',
  },
  {
    name: 'ASSEMBLYAI_API_KEY',
    when: 'runtime',
    required: 'optional',
    purpose: 'Alternative transcription provider.',
  },
  {
    name: 'YOUTUBE_API_KEY',
    when: 'runtime',
    required: 'optional',
    purpose: 'Richer YouTube metadata.',
  },
  {
    name: 'GEMINI_FLASH_MODEL / GEMINI_EMBEDDING_MODEL / GROQ_CHAT_MODEL',
    when: 'runtime',
    required: 'optional',
    purpose: 'Pin model IDs; currently-alive defaults are baked in.',
  },
  {
    name: 'MATCH_THRESHOLD',
    when: 'runtime',
    required: 'optional',
    purpose: 'Retrieval similarity floor. Default 0.5.',
  },
  {
    name: 'EMBEDDING_DIMENSIONS',
    when: 'runtime',
    required: 'optional',
    purpose: 'Vector size; 768 keeps the pgvector column and RPCs compatible.',
  },
  {
    name: 'MAX_VIDEO_DURATION_MINUTES',
    when: 'runtime',
    required: 'optional',
    purpose: 'Max allowed YouTube duration. Default 30.',
  },
  {
    name: 'TEMP_DIR',
    when: 'runtime',
    required: 'optional',
    purpose: 'Scratch directory for media temp files. Default /tmp.',
  },
  {
    name: 'WEBHOOK_TOLERANCE_SECONDS',
    when: 'runtime',
    required: 'optional',
    purpose: 'Webhook replay window. Default 300.',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    when: 'build',
    required: 'optional',
    purpose: 'Bare deployment hostname (no scheme); used for canonical/OG metadata URLs.',
  },
]

const mcpConfig = `{
  "mcpServers": {
    "video-rag": {
      "command": "bun",
      "args": ["run", "mcp"],
      "env": {
        "VIDEO_RAG_API_URL": "https://your-deployment.example.com",
        "VIDEO_RAG_API_KEY": "vidrag_sk_..."
      }
    }
  }
}`

const quickstart = `# 0. Create an API key (one-time, from the repo root — printed once, stored hashed)
bun run keys:create

# 1. Ingest — async: the 202 comes back the moment the record exists
curl -X POST https://your-deployment.example.com/api/v1/ingest \\
  -H "Authorization: Bearer vidrag_sk_..." \\
  -H "Idempotency-Key: review-0001" \\
  -H "Content-Type: application/json" \\
  -d '{"source":{"type":"youtube","url":"https://www.youtube.com/watch?v=..."}}'
# → 202 {"id":"...","status":"queued","status_url":"/api/v1/videos/{id}/status"}

#    (Multipart upload works the same way:)
#    curl -X POST .../api/v1/ingest -H "Authorization: Bearer vidrag_sk_..." \\
#      -F file=@deposition.mp4 -F title="Deposition — 2026-03-11"

# 2. Poll status until completed
curl https://your-deployment.example.com/api/v1/videos/{id}/status \\
  -H "Authorization: Bearer vidrag_sk_..."
# → {"id":"...","status":"completed","progress":100}

# 3. Receive the completion webhook (your registered HTTPS endpoint)
#    Headers:
#      X-Vidrag-Event: video.completed
#      X-Vidrag-Timestamp: 1769000000
#      X-Vidrag-Delivery: <uuid>
#      X-Vidrag-Signature: sha256=<64 hex chars>
#    Body: {"video_id":"...","title":"...","status":"completed",
#           "content_sha256":"...","status_url":"/api/v1/videos/{id}/status"}`

const verifySnippet = `// Verify a webhook delivery (Node crypto). The signature is HMAC-SHA256
// over "<timestamp>.<raw body>" — the timestamp header and the raw request
// body joined with a dot. Reject stale timestamps (replay) before comparing.
import crypto from 'node:crypto'

export function verifyDelivery(req, rawBody, secret, toleranceSeconds = 300) {
  const timestamp = req.headers['x-vidrag-timestamp']
  const received = req.headers['x-vidrag-signature'] // "sha256=<hex>"
  if (!timestamp || !received) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false

  const expected = 'sha256=' +
    crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}`

const chatSnippet = `curl -X POST https://your-deployment.example.com/api/v1/videos/{id}/chat \\
  -H "Authorization: Bearer vidrag_sk_..." \\
  -H "Content-Type: application/json" \\
  -d '{"message":"What did the witness say about the timeline?"}'
# → {"answer":"...",
#    "sources":[{"chunk_id":"...","video_id":"...","start_seconds":612.4,
#                "end_seconds":625.1,"quote":"<verbatim transcript span>",
#                "similarity":0.83}]}
#    Open /videos/{id}?t=612.4 to review the cited second.`

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-background">
      <ApiKeyBanner />
      <div className="container mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Video RAG API v1</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Evidence review that answers to the second. All routes live under{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/api/v1</code> on the
              deployment origin. Machine-readable contract:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">lib/api/v1-contracts.ts</code>.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">Back to app</Link>
          </Button>
        </div>

        <div className="mt-8">
          <Section id="authentication" title="Authentication">
            <p>
              Every API route requires a Bearer API key; the browser workspace uses the same keys
              entered in the banner. Keys look like{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">vidrag_sk_…</code>, are stored
              hashed (SHA-256), belong to an organization, carry scopes, and are rate limited
              per key.
            </p>
            <p>
              Scopes: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">ingest:write</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">library:read</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">chat:run</code>. Responses:
              missing/unknown/revoked key → <strong>401</strong>; scope mismatch →{' '}
              <strong>403</strong>; per-key limit exhausted → <strong>429</strong>. The only
              unauthenticated route is <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GET /api/health</code>{' '}
              (deploy-platform liveness).
            </p>
          </Section>

          <Section id="endpoints" title="Endpoints">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-medium">Method</th>
                    <th className="py-2 pr-4 font-medium">Path</th>
                    <th className="py-2 pr-4 font-medium">Scope</th>
                    <th className="py-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((e) => (
                    <tr key={e.path} className="border-b align-top">
                      <td className="py-3 pr-4 font-mono text-xs">{e.method}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{e.path}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{e.scope}</td>
                      <td className="py-3">{e.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="quickstart" title="Quickstart">
            <p>
              Ingest is async and idempotent: the same{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Idempotency-Key</code> replays
              the first response instead of creating a second video.
            </p>
            <Code>{quickstart}</Code>
          </Section>

          <Section id="webhooks" title="Webhooks">
            <p>
              On completion the API delivers a{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">video.completed</code> event
              to each registered HTTPS endpoint: initial attempt plus 3 retries with exponential
              backoff (1s, 2s, 4s); every attempt is logged. The signature is HMAC-SHA256 over{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">&quot;&lt;timestamp&gt;.&lt;raw body&gt;&quot;</code>,
              delivered as{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">X-Vidrag-Signature: sha256=…</code>{' '}
              with the unix timestamp in{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">X-Vidrag-Timestamp</code>.
              Receivers should reject deliveries older than{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">WEBHOOK_TOLERANCE_SECONDS</code>{' '}
              (default 300) as replays, then compare signatures with a timing-safe equality.
            </p>
            <Code>{verifySnippet}</Code>
          </Section>

          <Section id="chat" title="Cited answers">
            <p>
              Chat answers always carry their sources: a verbatim quote (an exact span of the
              stored transcript), the chunk id, the seconds range, and the similarity score.
              Deep links of the form{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/videos/&#123;id&#125;?t=612.4</code>{' '}
              open the player at the cited second.
            </p>
            <Code>{chatSnippet}</Code>
          </Section>

          <Section id="mcp" title="MCP server">
            <p>
              The MCP server (<code className="rounded bg-muted px-1.5 py-0.5 text-xs">video-rag</code>, stdio
              transport) is a thin client of API v1 — same credentials, same contracts. Tools:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">ingest_video</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">get_video</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">search</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">ask_video</code>,{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">get_transcript</code>. Resource:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">video://&#123;videoId&#125;/transcript</code>.
            </p>
            <Code>{mcpConfig}</Code>
          </Section>

          <Section id="environment" title="Environment variables (deploy manifest)">
            <p>
              Secrets enter at deploy time via approved secret cards — never from the repository.
              Mapping note: stored cards <em>SUPABASE_URL</em> and <em>GEMINI_API_KEY</em> map to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GOOGLE_GENERATIVE_AI_API_KEY</code>{' '}
              at deploy time.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-medium">Variable</th>
                    <th className="py-2 pr-4 font-medium">Read at</th>
                    <th className="py-2 pr-4 font-medium">Required</th>
                    <th className="py-2 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {envVars.map((v) => (
                    <tr key={v.name} className="border-b align-top">
                      <td className="py-3 pr-4 font-mono text-xs">{v.name}</td>
                      <td className="py-3 pr-4 text-xs">{v.when}</td>
                      <td className="py-3 pr-4 text-xs">{v.required}</td>
                      <td className="py-3">{v.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </main>
  )
}
