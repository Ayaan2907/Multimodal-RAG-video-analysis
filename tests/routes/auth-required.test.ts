import { describe, expect, it } from 'vitest'
import { POST as chatPOST } from '@/app/api/chat/route'
import { POST as uploadPOST } from '@/app/api/upload/route'
import { POST as youtubePOST } from '@/app/api/youtube/extract/route'
import { GET as statusGET } from '@/app/api/videos/[id]/status/route'
import { GET as manifestGET } from '@/app/api/v1/videos/[id]/manifest/route'

// Route-level integration proof: every API route answers 401 before any
// business logic runs when no API key is presented.

function unauthenticated(method: 'GET' | 'POST'): Request {
  return new Request('http://localhost/api/route', { method })
}

describe('route auth (401 without a key)', () => {
  it('POST /api/chat → 401', async () => {
    const res = await chatPOST(unauthenticated('POST') as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('missing_api_key')
  })

  it('POST /api/upload → 401', async () => {
    const res = await uploadPOST(unauthenticated('POST') as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('missing_api_key')
  })

  it('POST /api/youtube/extract → 401', async () => {
    const res = await youtubePOST(unauthenticated('POST') as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('missing_api_key')
  })

  it('GET /api/videos/[id]/status → 401', async () => {
    const res = await statusGET(unauthenticated('GET') as never, {
      params: Promise.resolve({ id: 'some-video' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('missing_api_key')
  })

  it('GET /api/v1/videos/[id]/manifest → 401', async () => {
    const res = await manifestGET(unauthenticated('GET') as never, {
      params: Promise.resolve({ id: 'some-video' }),
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('missing_api_key')
  })
})
