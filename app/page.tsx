import Link from 'next/link'
import {
  ArrowRight,
  Bot,
  FileDown,
  Gavel,
  Link2,
  ShieldCheck,
  Timer,
  Webhook,
} from 'lucide-react'
import VideoUpload from '@/components/video-upload'
import { ApiKeyBanner } from '@/components/api-key-banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Landing page — legal evidence review positioning (spec art_HKWx4t5y §7).
// The review workspace stays on this page below the pitch: the product's
// fastest proof is uploading footage and reading the first cited answer.

const steps = [
  {
    title: 'Ingest',
    body: 'Upload a file or paste a YouTube link. Audio is extracted, transcribed, and split into topic chunks with second-level offsets.',
  },
  {
    title: 'Ask',
    body: 'Ask questions in plain language. Each answer quotes the transcript verbatim and cites the exact seconds — click a citation and the player seeks there.',
  },
  {
    title: 'Export',
    body: 'Download SRT, VTT, Markdown, or JSON transcripts, SKILL.md packages, and the SHA-256 chain-of-custody manifest for the record.',
  },
]

const features = [
  {
    icon: Timer,
    title: 'Verbatim citations',
    body: 'Every answer carries its chunk id, seconds range, verbatim quote, and similarity score. No answer without evidence.',
  },
  {
    icon: ShieldCheck,
    title: 'Chain of custody',
    body: 'A SHA-256 content hash is computed at ingest; per-chunk provenance records the offsets and embedding model. Verifiable via the manifest endpoint.',
  },
  {
    icon: FileDown,
    title: 'Second-level exports',
    body: 'Transcripts export as srt, vtt, md, or json — timestamps derived from stored chunk offsets, not re-guessed.',
  },
  {
    icon: Webhook,
    title: 'Async API v1',
    body: 'Idempotent ingest answers 202 immediately; signed video.completed webhooks (HMAC-SHA256, 3 retries) notify your systems.',
  },
  {
    icon: Bot,
    title: 'MCP for agents',
    body: 'ingest_video, ask_video, search, and more over the Model Context Protocol — a thin client of the same versioned API.',
  },
  {
    icon: Link2,
    title: 'Private by default',
    body: 'Media sits in private storage behind short-lived signed URLs; API keys are hashed, scoped, and rate limited per organization.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <ApiKeyBanner />

      {/* Hero */}
      <section className="border-b">
        <div className="container mx-auto max-w-5xl px-4 py-16 text-center sm:py-20">
          <Badge variant="secondary" className="mb-5 gap-1.5">
            <Gavel className="h-3.5 w-3.5" />
            For legal evidence review
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Evidence review that answers to the second.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Ingest footage or a YouTube link. Video RAG transcribes it, and every
            answer cites the exact seconds that support it — verbatim quotes,
            second-level offsets, and a SHA-256 chain of custody behind each claim.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href="#review">
                Start a review
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/docs">Read the API docs</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-b bg-muted/40">
        <div className="container mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            From footage to cited answers
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {steps.map((step, i) => (
              <Card key={step.title}>
                <CardHeader>
                  <CardTitle className="text-base">
                    <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                    {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {step.body}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b">
        <div className="container mx-auto max-w-5xl px-4 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            Built for the record
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <feature.icon className="h-4 w-4 text-muted-foreground" />
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {feature.body}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Review workspace — the product itself, unchanged */}
      <section id="review" className="bg-muted/40">
        <div className="container mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-center text-2xl font-semibold tracking-tight">
            Start a review
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
            Ingest footage below, or paste a YouTube link. When processing
            completes, open the video to ask questions and click any citation to
            jump to that second.
          </p>
          <div className="mt-8">
            <VideoUpload />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="container mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground">
          <span>Video RAG — evidence review that answers to the second.</span>
          <Link href="/docs" className="underline underline-offset-4 hover:text-foreground">
            API docs &amp; MCP config
          </Link>
        </div>
      </footer>
    </main>
  )
}
