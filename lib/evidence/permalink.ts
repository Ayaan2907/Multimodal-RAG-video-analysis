// Permalink helpers for second-level evidence deep links (/videos/{id}?t=612.4).

/** Canonical URL for a video at a specific second — the shape every citation shares. */
export function buildPermalink(origin: string, videoId: string, seconds: number): string {
  return `${origin}/videos/${videoId}?t=${seconds}`
}

/**
 * Parse a ?t= value into a seek target in seconds. Returns null for absent,
 * malformed, or negative values — callers treat null as "no deep link".
 * Full-string validation: parseFloat alone would leniently accept "612.4x".
 */
export function parseSeekSeconds(value: string | undefined | null): number | null {
  if (value == null || value === '') return null
  if (!/^\d+(\.\d+)?$/.test(value)) return null
  const seconds = Number.parseFloat(value)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return seconds
}
