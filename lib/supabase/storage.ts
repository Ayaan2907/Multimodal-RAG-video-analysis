import { supabaseAdmin } from './admin'

const VIDEOS_BUCKET = 'videos'

export interface UploadResult {
  path: string
  publicUrl: string
  error?: string
}

export async function uploadVideoFile(
  file: File,
  fileName: string
): Promise<UploadResult> {
  try {
    const fileExt = fileName.split('.').pop()
    const filePath = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`

    const { data, error } = await supabaseAdmin.storage
      .from(VIDEOS_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      })

    if (error) {
      console.error('Upload error:', error)
      return { path: '', publicUrl: '', error: error.message }
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(VIDEOS_BUCKET)
      .getPublicUrl(data.path)

    return {
      path: data.path,
      publicUrl,
    }
  } catch (error) {
    console.error('Upload exception:', error)
    return {
      path: '',
      publicUrl: '',
      error: error instanceof Error ? error.message : 'Upload failed'
    }
  }
}

export async function deleteVideoFile(filePath: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.storage
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

export async function getVideoFileUrl(filePath: string): Promise<string> {
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from(VIDEOS_BUCKET)
    .getPublicUrl(filePath)

  return publicUrl
} 