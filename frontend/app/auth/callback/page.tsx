'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'

function CallbackHandler() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code  = searchParams.get('code')
    const state = searchParams.get('state')
    const err   = searchParams.get('error')

    if (err) {
      setError('Sign-in was cancelled or failed. Please try again.')
      setTimeout(() => router.push('/login'), 3000)
      return
    }

    if (!code) {
      router.push('/login')
      return
    }

    // Exchange code for session via Worker
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
    fetch(`${workerUrl}/auth/callback`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ code, state }),
    })
      .then(res => res.json())
      .then((data: any) => {
        if (data.error) throw new Error(data.error)
        // Worker sets httpOnly session cookie — redirect to returnTo
        let returnTo = '/dashboard'
        try {
          const stateObj = JSON.parse(atob(decodeURIComponent(state || '')))
          returnTo = stateObj.returnTo || '/dashboard'
        } catch { /* use default */ }
        router.replace(returnTo)
      })
      .catch((e: Error) => {
        console.error('[auth/callback]', e)
        setError(e.message || 'Authentication failed. Please try again.')
        setTimeout(() => router.push('/login'), 8000)
      })
  }, [router, searchParams])

  return (
    <>
      {error ? (
        <div style={{
          color:      'var(--nv-error)',
          fontSize:   '14px',
          textAlign:  'center',
          maxWidth:   '320px',
          lineHeight: 1.6,
        }}>
          {error}
          <br/>
          <span style={{ color: 'var(--nv-text-muted)', fontSize: '12px' }}>
            Redirecting to sign-in…
          </span>
        </div>
      ) : (
        <>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
            style={{ animation: 'spin 0.8s linear infinite' }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <circle cx="18" cy="18" r="15" stroke="var(--nv-platinum)" strokeWidth="3"/>
            <path d="M18 3a15 15 0 0 1 15 15"
              stroke="var(--nv-blue-slate)" strokeWidth="3" strokeLinecap="round"/>
          </svg>
          <p style={{
            color:      'var(--nv-text-muted)',
            fontSize:   '14px',
            fontFamily: 'var(--font-raleway)',
          }}>
            Completing sign-in…
          </p>
        </>
      )}
    </>
  )
}

export default function AuthCallbackPage() {
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
      <Suspense fallback={
        <p style={{ color: 'var(--nv-text-muted)', fontSize: '14px' }}>Loading…</p>
      }>
        <CallbackHandler />
      </Suspense>
    </div>
  )
}
