'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useUpload } from '@/lib/hooks/use-upload'
import { Upload, Youtube, CheckCircle, XCircle, Loader2 } from 'lucide-react'

export default function VideoUpload() {
  const router = useRouter()
  const upload = useUpload()
  
  // Form states
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [dragActive, setDragActive] = useState(false)

  // File upload handlers
  const handleFileSelect = useCallback((file: File) => {
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, '')) // Remove extension
    }
  }, [title])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = Array.from(e.dataTransfer.files)
    const videoFile = files.find(file => file.type.startsWith('video/'))
    
    if (videoFile) {
      handleFileSelect(videoFile)
    }
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }, [])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])

  const handleFileUpload = useCallback(async () => {
    const fileInput = document.getElementById('file-input') as HTMLInputElement
    const file = fileInput?.files?.[0]
    
    if (!file || !title.trim()) {
      return
    }

    await upload.uploadFile(file, title.trim(), description.trim() || undefined)
  }, [title, description, upload])

  const handleYouTubeUpload = useCallback(async () => {
    if (!youtubeUrl.trim()) {
      return
    }

    await upload.uploadYouTube(youtubeUrl.trim(), title.trim() || undefined, description.trim() || undefined)
  }, [youtubeUrl, title, description, upload])

  const handleViewVideo = useCallback(() => {
    if (upload.videoId) {
      router.push(`/videos/${upload.videoId}`)
    }
  }, [upload.videoId, router])

  const getStatusMessage = () => {
    switch (upload.status) {
      case 'uploading':
        return 'Uploading video...'
      case 'processing':
        return 'Processing video and generating embeddings...'
      case 'completed':
        return 'Video successfully processed!'
      case 'error':
        return upload.error || 'An error occurred'
      default:
        return ''
    }
  }

  const getStatusIcon = () => {
    switch (upload.status) {
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
      default:
        return null
    }
  }

  const isUploading = upload.isUploading || upload.isProcessing

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Upload Video</h1>
        <p className="text-muted-foreground">
          Upload a video file or provide a YouTube URL to get started with AI-powered analysis
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Video Information</CardTitle>
          <CardDescription>
            Provide basic information about your video
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              placeholder="Enter video title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Enter video description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isUploading}
            />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="file" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="file">
            <Upload className="w-4 h-4 mr-2" />
            Upload File
          </TabsTrigger>
          <TabsTrigger value="youtube">
            <Youtube className="w-4 h-4 mr-2" />
            YouTube URL
          </TabsTrigger>
        </TabsList>

        <TabsContent value="file" className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Drag and drop your video file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supported formats: MP4, AVI, MOV, WMV, WebM (max 100MB)
                  </p>
                </div>
                <input
                  id="file-input"
                  type="file"
                  accept="video/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                  disabled={isUploading}
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4"
                  onClick={() => document.getElementById('file-input')?.click()}
                  disabled={isUploading}
                >
                  Choose File
                </Button>
              </div>
              
              <Button
                className="w-full mt-4"
                onClick={handleFileUpload}
                disabled={!title.trim() || isUploading}
              >
                {upload.isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload Video'
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="youtube" className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="youtube-url">YouTube URL</Label>
                <Input
                  id="youtube-url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={isUploading}
                />
              </div>
              
              <Button
                className="w-full"
                onClick={handleYouTubeUpload}
                disabled={!youtubeUrl.trim() || isUploading}
              >
                {upload.isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Process YouTube Video'
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Progress and Status */}
      {upload.status !== 'idle' && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <span className="text-sm font-medium">{getStatusMessage()}</span>
            </div>
            
            {(upload.isUploading || upload.isProcessing) && (
              <Progress value={upload.progress} className="w-full" />
            )}

            {upload.status === 'completed' && (
              <div className="flex space-x-2">
                <Button onClick={handleViewVideo} className="flex-1">
                  View Video
                </Button>
                <Button variant="outline" onClick={upload.reset}>
                  Upload Another
                </Button>
              </div>
            )}

            {upload.status === 'error' && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Upload Failed</AlertTitle>
                <AlertDescription>{upload.error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
} 