import { getSupabaseAdmin } from './admin'

const VIDEOS_BUCKET = 'videos'

export interface UploadResult {
  path: string
  /** Short-lived signed playback URL — buckets are private, so no public URLs. */
  fileUrl: string
  error?: string
}

export async function uploadVideoFile(
  file: File,
  fileName: string
): Promise<UploadResult> {
  try {
    const fileExt = fileName.split('.').pop()
    const filePath = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`

    const { data, error } = await getSupabaseAdmin().storage
      .from(VIDEOS_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('Upload error:', error)
      return { path: '', fileUrl: '', error: error.message }
    }

    const url = await createVideoPlaybackUrl(data.path)
    if (!url) {
      return { path: data.path, fileUrl: '', error: 'Failed to create playback URL' }
    }

    return {
      path: data.path,
      fileUrl: url,
    }
  } catch (error) {
    console.error('Upload exception:', error)
    return {
      path: '',
      fileUrl: '',
      error: error instanceof Error ? error.message : 'Upload failed'
    }
  }
}

export async function deleteVideoFile(filePath: string): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin().storage
      .from(VIDEOS_BUCKET)
      .remove([filePath])

    if (error) {
      console.error('Delete error:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Delete exception:', error)
    return false
  }
}

// Server-side only: mints a short-lived signed URL for playback of a private
// bucket object. Buckets were previously public (audit critical #2).
export async function createVideoPlaybackUrl(
  filePath: string,
  expiresIn = 3600
): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseAdmin().storage
      .from(VIDEOS_BUCKET)
      .createSignedUrl(filePath, expiresIn)

    if (error || !data?.signedUrl) {
      console.error('Signed URL error:', error)
      return null
    }

    return data.signedUrl
  } catch (error) {
    console.error('Signed URL exception:', error)
    return null
  }
}
