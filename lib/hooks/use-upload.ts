import { useState, useCallback } from 'react'

export interface UploadState {
  isUploading: boolean
  isProcessing: boolean
  progress: number
  status: 'idle' | 'uploading' | 'processing' | 'completed' | 'error'
  error: string | null
  videoId: string | null
  videoData: any | null
}

export interface UseUploadReturn extends UploadState {
  uploadFile: (file: File, title: string, description?: string) => Promise<void>
  uploadYouTube: (url: string, title?: string, description?: string) => Promise<void>
  reset: () => void
  pollStatus: (videoId: string) => Promise<void>
}

export function useUpload(): UseUploadReturn {
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    isProcessing: false,
    progress: 0,
    status: 'idle',
    error: null,
    videoId: null,
    videoData: null
  })

  const reset = useCallback(() => {
    setState({
      isUploading: false,
      isProcessing: false,
      progress: 0,
      status: 'idle',
      error: null,
      videoId: null,
      videoData: null
    })
  }, [])

  const uploadFile = useCallback(async (file: File, title: string, description?: string) => {
    try {
      setState(prev => ({
        ...prev,
        isUploading: true,
        status: 'uploading',
        progress: 0,
        error: null
      }))

      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title)
      if (description) {
        formData.append('description', description)
      }

      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setState(prev => ({
          ...prev,
          progress: Math.min(prev.progress + 10, 90)
        }))
      }, 200)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const data = await response.json()

      setState(prev => ({
        ...prev,
        isUploading: false,
        isProcessing: true,
        status: 'processing',
        progress: 100,
        videoId: data.video.id,
        videoData: data.video
      }))

      // Start polling for processing status
      await pollStatus(data.video.id)

    } catch (error) {
      setState(prev => ({
        ...prev,
        isUploading: false,
        isProcessing: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed'
      }))
    }
  }, [])

  const uploadYouTube = useCallback(async (url: string, title?: string, description?: string) => {
    try {
      setState(prev => ({
        ...prev,
        isUploading: true,
        status: 'uploading',
        progress: 50,
        error: null
      }))

      const response = await fetch('/api/youtube/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          title,
          description
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'YouTube processing failed')
      }

      const data = await response.json()

      setState(prev => ({
        ...prev,
        isUploading: false,
        isProcessing: true,
        status: 'processing',
        progress: 100,
        videoId: data.video.id,
        videoData: data.video
      }))

      // Start polling for processing status
      await pollStatus(data.video.id)

    } catch (error) {
      setState(prev => ({
        ...prev,
        isUploading: false,
        isProcessing: false,
        status: 'error',
        error: error instanceof Error ? error.message : 'YouTube processing failed'
      }))
    }
  }, [])

  const pollStatus = useCallback(async (videoId: string) => {
    const maxPolls = 60 // Poll for up to 5 minutes
    let pollCount = 0

    const poll = async () => {
      try {
        const response = await fetch(`/api/videos/${videoId}/status`)
        
        if (!response.ok) {
          throw new Error('Failed to fetch video status')
        }

        const statusData = await response.json()

        setState(prev => ({
          ...prev,
          progress: statusData.progress || prev.progress
        }))

        if (statusData.status === 'completed') {
          setState(prev => ({
            ...prev,
            isProcessing: false,
            status: 'completed',
            progress: 100
          }))
          return
        }

        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Processing failed')
        }

        pollCount++
        if (pollCount < maxPolls) {
          setTimeout(poll, 5000) // Poll every 5 seconds
        } else {
          throw new Error('Processing timeout')
        }

      } catch (error) {
        setState(prev => ({
          ...prev,
          isProcessing: false,
          status: 'error',
          error: error instanceof Error ? error.message : 'Status polling failed'
        }))
      }
    }

    poll()
  }, [])

  return {
    ...state,
    uploadFile,
    uploadYouTube,
    reset,
    pollStatus
  }
} 