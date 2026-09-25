import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@/lib/evidence/hash'
import {
  buildChainOfCustodyManifest,
  ManifestError,
  type ManifestInput,
} from '@/lib/evidence/manifest'

// Acceptance proof (spec art_HKWx4t5y): the manifest content hash must equal
// the hash computed at ingest, and provenance must be complete per chunk.

// Independent digest of the fixture content (verified with coreutils sha256sum).
const INGEST_CONTENT = 'Officer arrives on scene. The witness states the door was open.'
const INGEST_DIGEST = '6a932b26e3a76f588763559a8827fd6370e5b87b252b354c81fd59cae1196751'

function makeInput(overrides: Partial<ManifestInput> = {}): ManifestInput {
  const videoId = '11111111-1111-1111-1111-111111111111'
  const chunkA = { id: 'aaaa-1', start_time_seconds: 0, end_time_seconds: 30 }
  const chunkB = { id: 'bbbb-2', start_time_seconds: 30, end_time_seconds: 60 }
  return {
    video: {
      id: videoId,
      title: 'Bodycam footage',
      source_type: 'upload',
      source_url: 'bodycam.mp4',
      file_size_bytes: 1024,
      content_sha256: INGEST_DIGEST,
      content_hash_scope: 'file',
      created_at: '2026-09-25T00:00:00.000Z',
    },
    chunks: [chunkA, chunkB],
    provenance: [
      {
        chunk_id: chunkA.id,
        chunk_index: 1,
        start_time_seconds: chunkA.start_time_seconds,
        end_time_seconds: chunkA.end_time_seconds,
        source_sha256: INGEST_DIGEST,
        embedding_model: 'text-embedding-004',
      },
      {
        chunk_id: chunkB.id,
        chunk_index: 2,
        start_time_seconds: chunkB.start_time_seconds,
        end_time_seconds: chunkB.end_time_seconds,
        source_sha256: INGEST_DIGEST,
        embedding_model: 'text-embedding-004',
      },
    ],
    generatedAt: '2026-09-25T01:00:00.000Z',
    ...overrides,
  }
}

describe('ingest-time hashing', () => {
  it('reproduces the independently verified fixture digest', () => {
    expect(sha256Hex(INGEST_CONTENT)).toBe(INGEST_DIGEST)
  })

  it('digests raw bytes identically to their string content', () => {
    const bytes = new TextEncoder().encode(INGEST_CONTENT)
    expect(sha256Hex(bytes)).toBe(INGEST_DIGEST)
  })
})

describe('buildChainOfCustodyManifest', () => {
  it('manifest content hash equals the ingest-time hash (acceptance invariant)', () => {
    const manifest = buildChainOfCustodyManifest(makeInput())
    expect(manifest.content.sha256).toBe(sha256Hex(INGEST_CONTENT))
    expect(manifest.content.sha256).toBe(INGEST_DIGEST)
    expect(manifest.content.hash_scope).toBe('file')
  })

  it('every chunk provenance row carries the source hash, offsets, and model', () => {
    const manifest = buildChainOfCustodyManifest(makeInput())
    expect(manifest.chunks).toHaveLength(2)
    for (const chunk of manifest.chunks) {
      expect(chunk.source_sha256).toBe(INGEST_DIGEST)
      expect(typeof chunk.chunk_index).toBe('number')
      expect(chunk.end_time_seconds).toBeGreaterThan(chunk.start_time_seconds)
      expect(chunk.embedding_model).toBe('text-embedding-004')
    }
  })

  it('chunks are ordered by chunk index regardless of input order', () => {
    const input = makeInput()
    const manifest = buildChainOfCustodyManifest({
      ...input,
      provenance: [...input.provenance].reverse(),
    })
    expect(manifest.chunks.map(c => c.chunk_index)).toEqual([1, 2])
  })

  it('missing provenance row for a chunk is refused — no partial custody', () => {
    const input = makeInput()
    expect(() =>
      buildChainOfCustodyManifest({ ...input, provenance: input.provenance.slice(0, 1) })
    ).toThrow(ManifestError)
    try {
      buildChainOfCustodyManifest({ ...input, provenance: input.provenance.slice(0, 1) })
    } catch (error) {
      expect((error as ManifestError).code).toBe('provenance_incomplete')
    }
  })

  it('orphan provenance rows are refused', () => {
    const input = makeInput()
    expect(() =>
      buildChainOfCustodyManifest({
        ...input,
        provenance: [
          ...input.provenance,
          {
            ...input.provenance[0],
            chunk_id: 'orphan-9',
            chunk_index: 3,
          },
        ],
      })
    ).toThrow(/unknown chunk/)
  })

  it('duplicate provenance rows for one chunk are refused', () => {
    const input = makeInput()
    expect(() =>
      buildChainOfCustodyManifest({
        ...input,
        provenance: [input.provenance[0], input.provenance[0]],
      })
    ).toThrow(/Duplicate provenance/)
  })

  it('legacy assets report a null hash honestly rather than fabricating one', () => {
    const manifest = buildChainOfCustodyManifest(
      makeInput({
        video: {
          id: 'legacy',
          title: 'Legacy asset',
          source_type: 'youtube',
          content_sha256: null,
          content_hash_scope: null,
          created_at: '2026-09-25T00:00:00.000Z',
        },
      })
    )
    expect(manifest.content.sha256).toBeNull()
    expect(manifest.content.hash_scope).toBeNull()
  })
})
