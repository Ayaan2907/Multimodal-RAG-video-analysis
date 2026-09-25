import { describe, expect, it } from 'vitest'

// Auth is the first thing every /api/v1 route does (spec art_HKWx4t5y §1/§4):
// 401 with the shared error envelope before any business logic runs when no
// key is presented, 403 when the key lacks the route's scope.

import { POST as ingestPOST } from '@/app/api/v1/ingest/route'
import { GET as statusGET } from '@/app/api/v1/videos/[id]/status/route'
import { GET as transcriptGET } from '@/app/api/v1/videos/[id]/transcript/route'
import { GET as manifestGET } from '@/app/api/v1/videos/[id]/manifest/route'
import { GET as skillExportGET } from '@/app/api/v1/videos/[id]/export/skill.md/route'
import { GET as skillZipGET } from '@/app/api/v1/skill.md.zip/route'
import { POST as chatPOST } from '@/app/api/v1/chat/route'
import { POST as videoChatPOST } from '@/app/api/v1/videos/[id]/chat/route'
import { POST as searchPOST } from '@/app/api/v1/search/route'

function request(method: 'GET' | 'POST', url: string, body?: string): Request {
  return new Request(url, {
    method,
    body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
}

const V1_ROUTES: Array<{ name: string; call: () => Promise<Response> }> = [
  {
    name: 'POST /api/v1/ingest',
    call: () => ingestPOST(request('POST', 'http://localhost/api/v1/ingest', '{}') as never),
  },
  {
    name: 'GET /api/v1/videos/[id]/status',
    call: () => statusGET(request('GET', 'http://localhost/api/v1/videos/vid/status') as never, { params: Promise.resolve({ id: 'vid' }) }),
  },
  {
    name: 'GET /api/v1/videos/[id]/transcript',
    call: () => transcriptGET(request('GET', 'http://localhost/api/v1/videos/vid/transcript') as never, { params: Promise.resolve({ id: 'vid' }) }),
  },
  {
    name: 'GET /api/v1/videos/[id]/manifest',
    call: () => manifestGET(request('GET', 'http://localhost/api/v1/videos/vid/manifest') as never, { params: Promise.resolve({ id: 'vid' }) }),
  },
  {
    name: 'GET /api/v1/videos/[id]/export/skill.md',
    call: () => skillExportGET(request('GET', 'http://localhost/api/v1/videos/vid/export/skill.md') as never, { params: Promise.resolve({ id: 'vid' }) }),
  },
  {
    name: 'GET /api/v1/skill.md.zip',
    call: () => skillZipGET(request('GET', 'http://localhost/api/v1/skill.md.zip') as never),
  },
  {
    name: 'POST /api/v1/chat',
    call: () => chatPOST(request('POST', 'http://localhost/api/v1/chat', '{}') as never),
  },
  {
    name: 'POST /api/v1/videos/[id]/chat',
    call: () => videoChatPOST(request('POST', 'http://localhost/api/v1/videos/vid/chat', '{}') as never, { params: Promise.resolve({ id: 'vid' }) }),
  },
  {
    name: 'POST /api/v1/search',
    call: () => searchPOST(request('POST', 'http://localhost/api/v1/search', '{}') as never),
  },
]

describe('v1 route auth', () => {
  for (const route of V1_ROUTES) {
    it(`${route.name} → 401 without a key`, async () => {
      const res = await route.call()
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error.code).toBe('missing_api_key')
      expect(typeof body.error.message).toBe('string')
    })
  }
})
