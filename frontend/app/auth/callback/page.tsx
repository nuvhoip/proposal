'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'

function CallbackHandler() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  // The Azure authorisation code is single-use. React 18 Strict Mode
  // double-invokes effects in dev, and useSearchParams()'s identity is not
  // guaranteed stable across renders in the App Router, so without this ref
  // the effect fires twice: the first exchange succeeds and redirects to the
  // dashboard, the second re-POSTs the already-redeemed code, gets a 401, and
  // its error path bounces the (now unmounted) page back to /login — the
  // "signed in successfully but landed on the login page" bug. Exchange once.
  const exchanged = useRef(false)

  useEffect(() => {
    if (exchanged.current) return
    exchanged.current = true

    // Timers are tracked so an unmounted callback page can never navigate.
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const bounceToLogin = (ms: number) =>
      timers.push(setTimeout(() => { if (!cancelled) router.push('/login') }, ms))
    const cleanup = () => { cancelled = true; timers.forEach(clearTimeout) }

    const code  = searchParams.get('code')
    const state = searchParams.get('state')
    const err   = searchParams.get('error')

    if (err) {
      setError('Sign-in was cancelled or failed. Please try again.')
      bounceToLogin(3000)
      return cleanup
    }

    if (!code) {
      router.push('/login')
      return cleanup
    }

    // Decode the "remember me" flag (and returnTo) that the login page packed
    // into `state` before the Azure AD redirect.
    let returnTo   = '/dashboard'
    let rememberMe = false
    try {
      const stateObj = JSON.parse(atob(decodeURIComponent(state || '')))
      returnTo   = stateObj.returnTo || '/dashboard'
      rememberMe = stateObj.rememberMe === true
    } catch { /* use defaults */ }

    // Exchange code for session via Worker
    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
    fetch(`${workerUrl}/auth/callback`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ code, state, rememberMe }),
    })
      .then(res => res.json())
      .then((data: any) => {
        if (cancelled) return
        // Worker responses are wrapped as { success, data } (lib/response.ts) —
        // a failure is { success: false, error }, so check both shapes.
        if (data.error || data.success === false) {
          throw new Error(data.error || 'Authentication failed. Please try again.')
        }
        // Worker sets httpOnly session cookie (long-lived if rememberMe) — redirect
        router.replace(returnTo)
      })
      .catch((e: Error) => {
        if (cancelled) return
        console.error('[auth/callback]', e)
        setError(e.message || 'Authentication failed. Please try again.')
        bounceToLogin(8000)
      })

    return cleanup
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
