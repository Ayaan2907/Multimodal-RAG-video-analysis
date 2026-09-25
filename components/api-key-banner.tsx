'use client'

import { useEffect, useState } from 'react'
import { getApiKey, saveApiKey, clearApiKey } from '@/lib/client/api-key'

// Rendered at the top of app pages: prompts for the org's API key until one is
// stored, and offers a clear action once set. The key lives in localStorage.
export function ApiKeyBanner() {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setHasKey(Boolean(getApiKey()))
  }, [])

  if (hasKey === null) return null

  if (hasKey) {
    return (
      <div className="flex items-center justify-end gap-3 px-4 py-2 text-xs text-muted-foreground">
        <span>API key configured</span>
        <button
          className="underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            clearApiKey()
            setHasKey(false)
            setDraft('')
          }}
        >
          Change key
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border-b bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950 dark:text-amber-100">
      <span>
        This app requires an API key (starts with{' '}
        <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">vidrag_sk_</code>). Ask your
        organization admin or create one with{' '}
        <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">npm run create-api-key</code>.
      </span>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!draft.trim()) return
          saveApiKey(draft)
          setHasKey(true)
          setDraft('')
        }}
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="vidrag_sk_..."
          className="w-64 rounded border border-amber-300 bg-white px-2 py-1 text-sm dark:bg-black"
          autoComplete="off"
        />
        <button
          type="submit"
          className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
        >
          Save key
        </button>
      </form>
    </div>
  )
}