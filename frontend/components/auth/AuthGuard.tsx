'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'

// ── Session context ────────────────────────────────────────────────────────────

export interface SessionUser {
  email:    string
  name:     string
  staffId?: string
}

const SessionCtx = createContext<SessionUser | null>(null)

/** Returns the signed-in user. Only valid inside <AuthGuard>. */
export function useSession(): SessionUser | null {
  return useContext(SessionCtx)
}

// ── AuthGuard ─────────────────────────────────────────────────────────────────

/**
 * Client-side auth guard for the App Router.
 *
 * Why client-side?
 * The session cookie (nuvho_session) is set by proposals-api.nuvho.com.
 * Next.js server components only see cookies scoped to the *frontend* domain
 * (proposals.nuvho.com / localhost:3000), so cookies() from next/headers
 * never finds it. Calling /auth/me from the browser is the only path where
 * the Worker's cross-domain cookie is sent correctly.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [user, setUser]   = useState<SessionUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
    fetch(`${workerUrl}/auth/me`, { credentials: 'include' })
      .then(async res => {
        if (!res.ok) throw new Error('Unauthorised')
        // Worker responses are wrapped as { success, data } (see lib/response.ts's
        // ok() helper) — unwrap .data to get { email, name, staffId, staff }.
        const body = await res.json() as any
        if (!body.success || !body.data) throw new Error('Unauthorised')
        const data = body.data
        setUser({ email: data.email, name: data.name, staffId: data.staffId })
        setReady(true)
      })
      .catch(() => {
        // Not authenticated — send back to login
        router.replace('/login')
      })
  }, [router])

  // While checking auth, show a centred spinner matching the callback page style
  if (!ready) {
    return (
      <div style={{
        minHeight:      '100vh',
        background:     'var(--nv-surface-page)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexDirection:  'column',
        gap:            '24px',
      }}>
        <NuvhoLogo variant="primary" height={40} />
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
          style={{ animation: 'spin 0.8s linear infinite' }}>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <circle cx="18" cy="18" r="15" stroke="var(--nv-platinum)" strokeWidth="3"/>
          <path d="M18 3a15 15 0 0 1 15 15"
            stroke="var(--nv-blue-slate)" strokeWidth="3" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }

  return (
    <SessionCtx.Provider value={user}>
      {children}
    </SessionCtx.Provider>
  )
}
