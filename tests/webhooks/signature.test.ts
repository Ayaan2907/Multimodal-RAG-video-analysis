import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSignatureHeader,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/lib/webhooks/signature'

// The signature contract (spec art_HKWx4t5y §4): HMAC-SHA256 over
// `${timestamp}.${rawBody}` in X-Vidrag-Signature: sha256=… — receivers must be
// able to recompute it, and stale/tampered deliveries must fail closed.

const SECRET = 'whsec_test_secret'
const BODY = JSON.stringify({ type: 'video.completed', data: { video_id: 'vid_1' } })
const TIMESTAMP = 1_700_000_000

function expectedSignature(timestamp: string, rawBody: string): string {
  return createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex')
}

describe('signWebhookPayload', () => {
  it('matches an independent HMAC-SHA256 recomputation over timestamp+body', () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).toBe(expectedSignature(String(TIMESTAMP), BODY))
  })

  it('changes when the body changes', () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).not.toBe(signWebhookPayload(SECRET, TIMESTAMP, `${BODY} `))
  })

  it('changes when the timestamp changes', () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).not.toBe(signWebhookPayload(SECRET, TIMESTAMP + 1, BODY))
  })

  it('changes when the secret changes', () => {
    expect(signWebhookPayload(SECRET, TIMESTAMP, BODY)).not.toBe(signWebhookPayload('whsec_other', TIMESTAMP, BODY))
  })
})

describe('buildSignatureHeader', () => {
  it('formats sha256=<hmac> (the timestamp rides in the X-Vidrag-Timestamp header)', () => {
    const header = buildSignatureHeader(SECRET, TIMESTAMP, BODY)
    expect(header).toBe(`sha256=${expectedSignature(String(TIMESTAMP), BODY)}`)
  })
})

describe('verifyWebhookSignature', () => {
  function signedInput(overrides: Record<string, unknown> = {}) {
    const timestamp = String(TIMESTAMP)
    return {
      secret: SECRET,
      rawBody: BODY,
      timestampHeader: timestamp,
      signatureHeader: `sha256=${expectedSignature(timestamp, BODY)}`,
      nowSeconds: TIMESTAMP,
      ...overrides,
    }
  }

  it('accepts a valid signature over the exact timestamp+body', () => {
    expect(verifyWebhookSignature(signedInput())).toEqual({ ok: true })
  })

  it('accepts a signature delivered at the tolerance boundary', () => {
    // Tolerance 300s → exactly ±300s still verifies (inclusive window).
    expect(verifyWebhookSignature(signedInput({ nowSeconds: TIMESTAMP + 300 }))).toEqual({ ok: true })
    expect(verifyWebhookSignature(signedInput({ nowSeconds: TIMESTAMP - 300 }))).toEqual({ ok: true })
  })

  it('rejects a tampered body with signature_mismatch', () => {
    const result = verifyWebhookSignature(signedInput({ rawBody: `${BODY}tamper` }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('signature_mismatch')
  })

  it('rejects a tampered signature', () => {
    const result = verifyWebhookSignature(signedInput({ signatureHeader: `sha256=${'0'.repeat(64)}` }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('signature_mismatch')
  })

  it('rejects a signature computed with the wrong secret', () => {
    // Signature stays valid but under a different key — must not verify.
    const result = verifyWebhookSignature(signedInput({ secret: 'whsec_other' }))
    expect(result.ok).toBe(false)
  })

  it('rejects stale timestamps as replay (older than tolerance)', () => {
    const result = verifyWebhookSignature(signedInput({ nowSeconds: TIMESTAMP + 301 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('stale_timestamp')
  })

  it('rejects far-future timestamps as replay (beyond tolerance)', () => {
    const result = verifyWebhookSignature(signedInput({ nowSeconds: TIMESTAMP - 301 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('stale_timestamp')
  })

  it('honors a custom tolerance window', () => {
    const result = verifyWebhookSignature(signedInput({ nowSeconds: TIMESTAMP + 400, toleranceSeconds: 600 }))
    expect(result.ok).toBe(true)
  })

  it('rejects non-numeric timestamps', () => {
    const result = verifyWebhookSignature(
      signedInput({ timestampHeader: 'not-a-number', signatureHeader: 'sha256=abc' }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_format')
  })

  it('rejects missing headers', () => {
    expect(verifyWebhookSignature(signedInput({ timestampHeader: undefined }))).toMatchObject({ ok: false })
    expect(verifyWebhookSignature(signedInput({ signatureHeader: undefined }))).toMatchObject({ ok: false })
  })

  it('rejects malformed signature headers', () => {
    for (const header of ['sha256', 'md5=deadbeef', 'sha256=short', 'sha256=zzzz', '']) {
      expect(verifyWebhookSignature(signedInput({ signatureHeader: header })).ok).toBe(false)
    }
  })
})
