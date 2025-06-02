'use client'

import { VideoWithDetails } from '@/lib/supabase/database'
import { MessageCircle, Bot } from 'lucide-react'

interface ChatInterfaceProps {
  video: VideoWithDetails
}

export function ChatInterface({ video }: ChatInterfaceProps) {
  return (
    <div className="bg-muted/30 rounded-lg p-6 h-fit sticky top-8">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Video Chat</h3>
      </div>

      <div className="text-center py-8">
        <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <h4 className="font-medium mb-2">Chat Coming Soon</h4>
        <p className="text-sm text-muted-foreground mb-4">
          Ask questions about this video and get AI-powered responses with timestamp references.
        </p>
        
        {video.processing_status === 'completed' ? (
          <div className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded">
            ✓ Video ready for chat
          </div>
        ) : (
          <div className="text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded">
            ⏳ Processing video...
          </div>
        )}
      </div>

      {/* Future chat interface will go here */}
      <div className="space-y-3 opacity-50">
        <div className="flex gap-2">
          <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex-1 bg-background/50 rounded-lg p-3">
            <p className="text-sm">Hello! I can help you understand this video. What would you like to know?</p>
          </div>
        </div>
        
        <div className="flex gap-2 justify-end">
          <div className="flex-1 bg-primary/10 rounded-lg p-3 max-w-xs">
            <p className="text-sm">What is this video about?</p>
          </div>
          <div className="w-8 h-8 bg-muted rounded-full"></div>
        </div>
      </div>
    </div>
  )
} 