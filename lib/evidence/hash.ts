import { createHash } from 'node:crypto'

/** Hex-encoded SHA-256 over a string (UTF-8) or raw bytes. */
export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}
