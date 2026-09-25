import { describe, expect, it } from 'vitest'
import { GET as healthGET } from '@/app/api/health/route'

// The deploy platform's healthcheckPath depends on this contract: shallow
// liveness only — 200 while the process is up, no auth (by design), and no
// dependency on database or secret configuration.

describe('GET /api/health', () => {
  it('answers 200 {ok:true} without credentials or configuration', async () => {
    const res = await healthGET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe('video-rag')
    expect(typeof body.timestamp).toBe('string')
  })
})
