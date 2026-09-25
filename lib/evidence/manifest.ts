// Chain-of-custody manifest builder — pure shaping of stored records. The
// manifest is the defensibility artifact legal reviewers ask for first: it
// ties every chunk back to the exact hashed content and offset range it was
// derived from (spec art_HKWx4t5y §3).

export interface ProvenanceRow {
  chunk_id: string
  chunk_index: number
  start_time_seconds: number
  end_time_seconds: number
  source_sha256: string | null
  embedding_model: string | null
}

export interface ManifestVideoInput {
  id: string
  title: string
  source_type: 'upload' | 'youtube'
  source_url?: string | null
  file_size_bytes?: number | null
  content_sha256?: string | null
  content_hash_scope?: 'file' | 'transcript' | null
  created_at: string
}

export interface ManifestChunkInput {
  id: string
  start_time_seconds: number
  end_time_seconds: number
}

export interface ManifestInput {
  video: ManifestVideoInput
  /** All chunks belonging to the video (the manifest must cover every one). */
  chunks: ManifestChunkInput[]
  /** Provenance rows stored for those chunks. */
  provenance: ProvenanceRow[]
  generatedAt: string
}

export interface ChainOfCustodyManifest {
  video_id: string
  generated_at: string
  content: {
    sha256: string | null
    hash_scope: 'file' | 'transcript' | null
    file_size_bytes: number | null
    source_type: 'upload' | 'youtube'
    source_url: string | null
  }
  chunks: Array<{
    chunk_id: string
    chunk_index: number
    start_time_seconds: number
    end_time_seconds: number
    source_sha256: string | null
    embedding_model: string | null
  }>
}

/** Raised when the stored records cannot produce a complete manifest. */
export class ManifestError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ManifestError'
    this.code = code
  }
}

/**
 * Build the manifest, refusing incomplete custody: every chunk must have
 * exactly one provenance row (no silent partial manifests — a degraded
 * manifest would be false assurance).
 */
export function buildChainOfCustodyManifest(input: ManifestInput): ChainOfCustodyManifest {
  const byChunk = new Map<string, ProvenanceRow>()
  for (const row of input.provenance) {
    if (byChunk.has(row.chunk_id)) {
      throw new ManifestError('provenance_duplicate', `Duplicate provenance rows for chunk ${row.chunk_id}`)
    }
    byChunk.set(row.chunk_id, row)
  }

  for (const chunk of input.chunks) {
    if (!byChunk.has(chunk.id)) {
      throw new ManifestError('provenance_incomplete', `Missing provenance row for chunk ${chunk.id}`)
    }
  }

  const chunkIds = new Set(input.chunks.map(chunk => chunk.id))
  for (const chunkId of byChunk.keys()) {
    if (!chunkIds.has(chunkId)) {
      throw new ManifestError('provenance_orphan', `Provenance row references unknown chunk ${chunkId}`)
    }
  }

  const rows = input.chunks
    .map(chunk => byChunk.get(chunk.id)!)
    .sort((a, b) => a.chunk_index - b.chunk_index)

  return {
    video_id: input.video.id,
    generated_at: input.generatedAt,
    content: {
      sha256: input.video.content_sha256 ?? null,
      hash_scope: input.video.content_hash_scope ?? null,
      file_size_bytes: input.video.file_size_bytes ?? null,
      source_type: input.video.source_type,
      source_url: input.video.source_url ?? null,
    },
    chunks: rows.map(row => ({
      chunk_id: row.chunk_id,
      chunk_index: row.chunk_index,
      start_time_seconds: row.start_time_seconds,
      end_time_seconds: row.end_time_seconds,
      source_sha256: row.source_sha256,
      embedding_model: row.embedding_model,
    })),
  }
}
