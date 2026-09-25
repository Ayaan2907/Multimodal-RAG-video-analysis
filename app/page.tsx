import VideoUpload from '@/components/video-upload'
import { ApiKeyBanner } from '@/components/api-key-banner'

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <ApiKeyBanner />
      <VideoUpload />
    </main>
  )
}