'use client'

import { useState, FormEvent, useRef, useEffect } from 'react'
import { VideoWithDetails } from '@/lib/supabase/database'
import { MessageCircle, Bot, User, Send, CornerDownLeft, ExternalLink, Zap } from 'lucide-react'
import { cn } from '@/lib/utils' // Assuming you have a cn utility for classnames

// Interfaces for chat message structure
interface ChatSource {
  chunkId: string
  title: string | null
  startTimeSeconds: number
  endTimeSeconds: number
  startTimeFormatted: string
  endTimeFormatted: string
  matchedOn: 'transcript' | 'visual' | 'multimodal'
  similarity: number
}

interface ChatMessage {
  id: string
  sender: 'user' | 'ai'
  text: string
  sources?: ChatSource[]
  timestamp: Date
}

interface ChatInterfaceProps {
  video: VideoWithDetails
  onSourceClick?: (timeInSeconds: number) => void // Optional: for player interaction
}

export function ChatInterface({ video, onSourceClick }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(scrollToBottom, [messages]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!inputValue.trim() || isLoading || video.processing_status !== 'completed') return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sender: 'user',
      text: inputValue,
      timestamp: new Date(),
    }
    setMessages(prevMessages => [...prevMessages, userMessage])
    setInputValue('')
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          message: userMessage.text,
          // TODO: chatHistory: messages // Consider sending some history
        }),
      })

      if (!response.ok) {
        let errorDetail = 'Failed to get response from AI';
        try {
          // Attempt to parse the error response as JSON
          const errorData = await response.json();
          errorDetail = errorData.error || errorDetail;
        } catch (jsonError) {
          // If JSON parsing fails, use the status text or a generic error
          console.error('Failed to parse error response as JSON:', jsonError);
          errorDetail = response.statusText || errorDetail;
        }
        throw new Error(errorDetail);
      }

      const data = await response.json()
      const aiMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: data.answer,
        sources: data.sources,
        timestamp: new Date(),
      }
      setMessages(prevMessages => [...prevMessages, aiMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred'
      setError(errorMessage)
      setMessages(prevMessages => [...prevMessages, {
        id: crypto.randomUUID(),
        sender: 'ai',
        text: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date()
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const isChatDisabled = video.processing_status !== 'completed';

  return (
    <div className="bg-muted/30 rounded-lg p-4 md:p-6 h-fit sticky top-8 flex flex-col max-h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Video Chat</h3>
      </div>

      {isChatDisabled && (
         <div className="text-center py-8 flex-grow flex flex-col justify-center items-center">
          <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h4 className="font-medium mb-2">Video Processing</h4>
          <p className="text-sm text-muted-foreground mb-4 px-4">
            Please wait until the video processing is complete to start chatting.
          </p>
          <div className="text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded">
            ⏳ Current status: {video.processing_status}
          </div>
        </div>
      )}
      
      {!isChatDisabled && messages.length === 0 && !isLoading && (
        <div className="text-center py-8 flex-grow flex flex-col justify-center items-center">
          <MessageCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h4 className="font-medium mb-2">Ask Away!</h4>
          <p className="text-sm text-muted-foreground mb-4 px-4">
            Ask questions about this video and get AI-powered responses with timestamp references.
          </p>
        </div>
      )}

      <div className={cn("flex-grow overflow-y-auto space-y-4 pr-2", { 'opacity-50': isChatDisabled })}>
        {messages.map(message => (
          <div key={message.id} className={cn("flex gap-3", message.sender === 'user' ? 'justify-end' : '')}>
            {message.sender === 'ai' && (
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center shrink-0 mt-1">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className={cn(
              "rounded-lg p-3 max-w-[80%]",
              message.sender === 'user' ? 'bg-primary/90 text-primary-foreground' : 'bg-background/80 backdrop-blur-sm ring-1 ring-border/50',
            )}>
              <p className="text-sm whitespace-pre-wrap">{message.text}</p>
              {message.sender === 'ai' && message.sources && message.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <h5 className="text-xs font-semibold mb-1.5 text-muted-foreground">Sources:</h5>
                  <div className="space-y-1.5">
                    {message.sources.map(source => (
                      <button
                        key={source.chunkId}
                        onClick={() => onSourceClick && onSourceClick(source.startTimeSeconds)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!onSourceClick}
                        title={onSourceClick ? "Click to jump to this part of the video" : "Video interaction disabled"}
                      >
                        <div className="font-medium text-primary/80 truncate">
                          {source.title || `Segment ${source.startTimeFormatted} - ${source.endTimeFormatted}`}
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground/80">
                          <span>{source.startTimeFormatted} - {source.endTimeFormatted}</span>
                          <span className="capitalize text-[0.65rem] bg-muted/30 px-1.5 py-0.5 rounded-sm">
                             {source.matchedOn} ({source.similarity.toFixed(2)})
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[0.6rem] text-right mt-1.5 opacity-60">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {message.sender === 'user' && (
              <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0 mt-1">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center p-2 text-sm text-muted-foreground">
          <Bot className="h-4 w-4 animate-spin mr-2" />
          AI is thinking...
        </div>
      )}
      {error && !isLoading && (
         <div className="p-2 text-sm text-red-600 bg-red-50 rounded-md">
          Error: {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className={cn("mt-4 flex items-center gap-2 border-t border-border/50 pt-4", { 'opacity-50 cursor-not-allowed': isChatDisabled })}>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder={isChatDisabled ? "Video processing..." : "Ask about the video..."}
          className="flex-1 p-2.5 text-sm bg-background/70 backdrop-blur-sm rounded-lg border border-border/50 focus:ring-2 focus:ring-primary/50 focus:outline-none resize-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
          disabled={isLoading || isChatDisabled}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault(); // Prevent newline
              handleSubmit(e as unknown as FormEvent<HTMLFormElement>);
            }
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim() || isChatDisabled}
          className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-muted/30 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Send message"
        >
          {isLoading ? <Bot className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </form>
       <div className="text-xs text-muted-foreground/60 mt-2 text-center">
        AI can make mistakes. Verify important information.
      </div>
    </div>
  )
} 