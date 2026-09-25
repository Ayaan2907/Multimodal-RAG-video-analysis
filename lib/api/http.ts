import { NextResponse } from 'next/server'
import type { AuthResult } from '@/lib/auth/request'

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status })
}

export function authErrorResponse(result: Extract<AuthResult, { ok: false }>): NextResponse {
  return jsonError(result.status, result.code, result.message)
}
