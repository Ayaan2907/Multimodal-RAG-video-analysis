import { createHmac, timingSafeEqual } from 'node:crypto'

// Webhook signing (spec art_HKWx4t5y §4).
//
// Signature = HMAC-SHA256(signingSecret, `${timestamp}.${rawBody}`), delivered
// as `X-Vidrag-Signature: sha256=<hex>` alongside `X-Vidrag-Timestamp` (unix
// seconds). The timestamp is inside the signed material, so a receiver who
// rejects stale timestamps gets replay protection for free — a captured
// (signature, timestamp, body) triple past the tolerance window no longer
// verifies. Verification is pure so receivers (and tests) can check the
// contract without any server.

export const WEBHOOK_SIGNATURE_HEADER = 'X-Vidrag-Signature'
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Vidrag-Timestamp'
export const WEBHOOK_EVENT_HEADER = 'X-Vidrag-Event'
export const WEBHOOK_DELIVERY_HEADER = 'X-Vidrag-Delivery'

/** How far a delivery timestamp may drift before it is rejected as a replay. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300 // 5 minutes

export function signWebhookPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')
}

export function buildSignatureHeader(secret: string, timestampSeconds: number, rawBody: string): string {
  return `sha256=${signWebhookPayload(secret, timestampSeconds, rawBody)}`
}

export type WebhookVerificationFailure =
  | 'invalid_format'
  | 'signature_mismatch'
  | 'stale_timestamp'

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: WebhookVerificationFailure }

const SIGNATURE_HEADER_PATTERN = /^sha256=([0-9a-f]{64})$/

/**
 * Verify a delivered webhook. Order matters: malformed headers are a format
 * error, stale timestamps are replay (rejected before any comparison), and
 * everything else is a timing-safe signature comparison.
 */
export function verifyWebhookSignature(input: {
  secret: string
  timestampHeader: string | null
  signatureHeader: string | null
  rawBody: string
  nowSeconds?: number
  toleranceSeconds?: number
}): WebhookVerificationResult {
  const { secret, rawBody } = input
  const timestamp = input.timestampHeader
  const signatureHeader = input.signatureHeader?.trim().toLowerCase()

  if (!timestamp || !signatureHeader) {
    return { ok: false, reason: 'invalid_format' }
  }

  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: 'invalid_format' }
  }

  const match = SIGNATURE_HEADER_PATTERN.exec(signatureHeader)
  if (!match) {
    return { ok: false, reason: 'invalid_format' }
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS
  const deliveredAt = Number.parseInt(timestamp, 10)

  // Replay rejection: same timestamp+body re-verified inside the tolerance
  // window still passes; past it the delivery is stale and must be rejected.
  if (Math.abs(now - deliveredAt) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' }
  }

  const expected = signWebhookPayload(secret, deliveredAt, rawBody)
  const presented = match[1]

  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(presented, 'hex'))) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  return { ok: true }
}
