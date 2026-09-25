import { describe, expect, it } from 'vitest'
import { buildPermalink, parseSeekSeconds } from '@/lib/evidence/permalink'

// Spec art_HKWx4t5y §2: permalinks are /videos/{id}?t=612.4 — every citation
// and transcript timestamp links a reviewer to the exact second.

describe('buildPermalink', () => {
  it('shapes /videos/{id}?t={seconds}', () => {
    expect(buildPermalink('https://app.example.com', 'vid-9', 612.4)).toBe(
      'https://app.example.com/videos/vid-9?t=612.4'
    )
  })
})

describe('parseSeekSeconds', () => {
  it.each([
    ['612.4', 612.4],
    ['0', 0],
    ['61', 61],
  ])('parses %s → %d', (input, expected) => {
    expect(parseSeekSeconds(input)).toBe(expected)
  })

  it.each([
    'junk',
    'NaN',
    '-5',
    '612.4x',
  ])('rejects %s', input => {
    expect(parseSeekSeconds(input)).toBeNull()
  })

  it('treats absent values as no deep link', () => {
    expect(parseSeekSeconds(undefined)).toBeNull()
    expect(parseSeekSeconds(null)).toBeNull()
    expect(parseSeekSeconds('')).toBeNull()
  })
})
