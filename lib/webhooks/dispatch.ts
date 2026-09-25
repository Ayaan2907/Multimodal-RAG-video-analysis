import { randomUUID } from 'node:crypto'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  buildSignatureHeader,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from './signature'

// Webhook delivery for video.completed (spec art_HKWx4t5y §4).
//
// Contract: initial attempt + 3 retries, exponential backoff (1s, 2s, 4s).
// Every attempt lands in webhook_deliveries — the observability trail. Dispatch
// is fire-and-forget from the processing pipeline: a webhook outage must never
// fail transcription, and dispatch never throws into its caller.

export const VIDEO_COMPLETED_EVENT = 'video.completed'
export const WEBHOOK_MAX_RETRIES = 3
export const WEBHOOK_BACKOFF_BASE_MS = 1_000

export interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
}

export interface WebhookPayloadData {
  video_id: string
  title: string | null
  status: 'completed'
  content_sha256: string | null
  status_url: string
}

export interface WebhookDeliveryResult {
  delivered: boolean
  attempts: number
  lastStatusCode?: number
  lastError?: string
}

export interface WebhookDispatchDeps {
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
  maxRetries?: number
  backoffMs?: number
  deliveryId?: string
}

/** Exponential backoff: base * 2^attemptIndex → 1000, 2000, 4000, … */
export function backoffDelayMs(attemptIndex: number, baseMs: number = WEBHOOK_BACKOFF_BASE_MS): number {
  return baseMs * 2 ** attemptIndex
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Deliver one signed event to one endpoint, retrying up to `maxRetries` times
 * after the initial attempt. Success is any 2xx status code.
 */
export async function deliverWebhook(input: {
  endpoint: Pick<WebhookEndpoint, 'id' | 'url' | 'secret'>
  eventType: string
  payload: WebhookEventEnvelope
  deps?: WebhookDispatchDeps
}): Promise<WebhookDeliveryResult> {
  const { endpoint, eventType, payload } = input
  const deps = input.deps ?? {}
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleepImpl = deps.sleepImpl ?? sleep
  const maxRetries = deps.maxRetries ?? WEBHOOK_MAX_RETRIES
  const deliveryId = deps.deliveryId ?? randomUUID()

  const rawBody = JSON.stringify(payload)
  const maxAttempts = 1 + maxRetries
  let lastStatusCode: number | undefined
  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestampSeconds = Math.floor(Date.now() / 1000)

    try {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [WEBHOOK_EVENT_HEADER]: eventType,
          [WEBHOOK_DELIVERY_HEADER]: deliveryId,
          [WEBHOOK_TIMESTAMP_HEADER]: String(timestampSeconds),
          [WEBHOOK_SIGNATURE_HEADER]: buildSignatureHeader(endpoint.secret, timestampSeconds, rawBody),
        },
        body: rawBody,
      })

      lastStatusCode = response.status
      await recordDeliveryAttempt(endpoint.id, eventType, payload, attempt, response.ok, response.status, undefined)

      if (response.ok) {
        return { delivered: true, attempts: attempt, lastStatusCode }
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await recordDeliveryAttempt(endpoint.id, eventType, payload, attempt, false, undefined, lastError)
    }

    if (attempt < maxAttempts) {
      await sleepImpl(backoffDelayMs(attempt - 1))
    }
  }

  return { delivered: false, attempts: maxAttempts, lastStatusCode, lastError }
}

interface DeliveryRow {
  endpoint_id: string
  event_type: string
  payload: unknown
  attempt: number
  ok: boolean
  status_code: number | null
  error: string | null
}

/** Best-effort attempt log — a failing insert is logged, never propagated. */
async function recordDeliveryAttempt(
  endpointId: string,
  eventType: string,
  payload: unknown,
  attempt: number,
  ok: boolean,
  statusCode: number | undefined,
  errorMessage: string | undefined,
): Promise<void> {
  const row: DeliveryRow = {
    endpoint_id: endpointId,
    event_type: eventType,
    payload,
    attempt,
    ok,
    status_code: statusCode ?? null,
    error: errorMessage ?? null,
  }
  try {
    const { error } = await getSupabaseAdmin().from('webhook_deliveries').insert(row)
    if (error) {
      console.error('Failed to record webhook delivery attempt:', error)
    }
  } catch (error) {
    console.error('Failed to record webhook delivery attempt:', error)
  }
}

export interface WebhookEventEnvelope {
  type: string
  created_at: string
  data: WebhookPayloadData
}

export function buildVideoCompletedPayload(data: WebhookPayloadData): WebhookEventEnvelope {
  return {
    type: VIDEO_COMPLETED_EVENT,
    created_at: new Date().toISOString(),
    data,
  }
}

/**
 * Deliver video.completed to every endpoint of the org subscribed to the
 * event. Returns per-endpoint results; individual failures do not affect the
 * others and never throw.
 */
export async function dispatchVideoCompleted(
  organizationId: string,
  data: WebhookPayloadData,
  deps?: WebhookDispatchDeps,
): Promise<WebhookDeliveryResult[]> {
  try {
    const { data: endpoints, error } = await getSupabaseAdmin()
      .from('webhook_endpoints')
      .select('id, url, secret, events')
      .eq('organization_id', organizationId)

    if (error) {
      console.error('Failed to load webhook endpoints:', error)
      return []
    }

    const subscribed = (endpoints ?? []).filter(endpoint =>
      (endpoint.events ?? []).includes(VIDEO_COMPLETED_EVENT),
    ) as WebhookEndpoint[]

    const payload = buildVideoCompletedPayload(data)
    return await Promise.all(
      subscribed.map(endpoint =>
        deliverWebhook({ endpoint, eventType: VIDEO_COMPLETED_EVENT, payload, deps }),
      ),
    )
  } catch (error) {
    console.error('Webhook dispatch failed:', error)
    return []
  }
}

/**
 * Fire-and-forget completion notification for the processing pipeline.
 * Called after the status flips to completed; must never reject.
 */
export function notifyVideoCompleted(
  organizationId: string,
  data: WebhookPayloadData,
): void {
  void dispatchVideoCompleted(organizationId, data).catch(error => {
    console.error('Unexpected webhook dispatch rejection:', error)
  })
}
