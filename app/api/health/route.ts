import { NextResponse } from 'next/server'

// GET /api/health — liveness probe for the deploy platform (Railway
// healthcheckPath, spec art_HKWx4t5y §7). Deliberately dependency-free: it
// reports process liveness only and never touches the database, the storage
// client, or any secret, so it answers 200 whenever the server is up
// regardless of environment configuration and cannot leak credential state.
// This is the one unauthenticated API route by design.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json({
    ok: true,
    service: 'video-rag',
    timestamp: new Date().toISOString(),
  })
}
