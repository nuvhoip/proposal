'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'

/**
 * Sign-in page.
 *
 * Layout mirrors the nuvho-onboarding-ui Login screen (src/pages/Login.jsx):
 * a single centred column — logo, white card holding the email/password form,
 * a "Staff & Admin" divider, then the Microsoft button. The previous
 * split-screen brand panel (hero copy, feature list, decorative circles) was
 * retired so both products present one sign-in system.
 *
 * NOTE ON EMAIL/PASSWORD: the Worker currently exposes Azure OAuth only
 * (/auth/callback, /auth/me, /auth/signout) — there is no POST /auth/login
 * handler yet. The form below posts to that route and degrades honestly when
 * it is missing (see handlePasswordLogin), so the UI is ready the moment the
 * endpoint lands. Do not present password sign-in as working until then.
 */
export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(false)
  const [loadingPassword, setLoadingPassword] = useState(false)
  const [loadingAzure, setLoadingAzure]       = useState(false)

  const loading = loadingPassword || loadingAzure

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoadingPassword(true)
    try {
      const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL
      const res = await fetch(`${workerUrl}/auth/login`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ email, password, rememberMe }),
      })

      // The password endpoint is not built yet — say so plainly rather than
      // blaming the user's credentials for a missing route.
      if (res.status === 404 || res.status === 405 || res.status === 501) {
        setError('Password sign-in isn’t enabled yet. Please use Microsoft sign-in below.')
        return
      }
      if (res.status === 401 || res.status === 403) {
        setError('Invalid email or password.')
        return
      }
      if (!res.ok) {
        setError(`Sign-in failed (${res.status}) — contact support@nuvho.com.`)
        return
      }

      // Worker responses are wrapped as { success, data } (lib/response.ts ok()).
      const body = await res.json() as any
      if (!body.success) {
        setError(body.error ?? 'Sign-in failed — contact support@nuvho.com.')
        return
      }
      router.replace('/dashboard')
    } catch {
      setError('Unable to reach the sign-in service. Check your connection and try again.')
    } finally {
      setLoadingPassword(false)
    }
  }

  function handleMicrosoftLogin() {
    setLoadingAzure(true)
    setError(null)
    try {
      const tenantId    = process.env.NEXT_PUBLIC_AZURE_TENANT_ID
      const clientId    = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID
      const appUrl      = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      const redirectUri = encodeURIComponent(`${appUrl}/auth/callback`)
      const scope       = encodeURIComponent('openid profile email User.Read')
      // "Remember me" travels through the OAuth round-trip in `state` (along with
      // the nonce and returnTo) since the callback page has no other memory of
      // the login form's checkbox state.
      const state       = encodeURIComponent(btoa(JSON.stringify({
        nonce: crypto.randomUUID(),
        returnTo: '/dashboard',
        rememberMe,
      })))

      window.location.href =
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize` +
        `?client_id=${clientId}` +
        `&response_type=code` +
        `&redirect_uri=${redirectUri}` +
        `&scope=${scope}` +
        `&state=${state}` +
        `&prompt=login`
    } catch {
      setError('Unable to initiate sign-in. Please try again.')
      setLoadingAzure(false)
    }
  }

  return (
    <div className="login-root">
      <div className="login-col">

        <div className="login-logo">
          <NuvhoLogo variant="primary" height={44} />
        </div>

        <div className="login-card">
          <p className="login-card__title">Sign In</p>
          <p className="login-card__sub">Access the Nuvho Proposal System</p>

          <form onSubmit={handlePasswordLogin} className="login-form">
            <div className="login-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                placeholder="you@nuvho.com"
              />
            </div>

            <div className="login-field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="login-error" role="alert">{error}</p>
            )}

            <button type="submit" className="login-submit" disabled={loading} aria-busy={loadingPassword}>
              {loadingPassword && <LoadingSpinner />}
              {loadingPassword ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="login-divider">
          <span>Staff &amp; Admin</span>
        </div>

        <button
          type="button"
          className="login-ms-btn"
          onClick={handleMicrosoftLogin}
          disabled={loading}
          aria-busy={loadingAzure}
        >
          {loadingAzure ? <LoadingSpinner tone="teal" /> : <MicrosoftIcon />}
          {loadingAzure ? 'Waiting for Microsoft…' : 'Sign in with Microsoft'}
        </button>

        <label className="login-remember">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={e => setRememberMe(e.target.checked)}
            disabled={loading}
          />
          Remember me for 30 days
        </label>

        <p className="login-note">
          Only <strong>@nuvho.com</strong> accounts are authorised.
          Contact <a href="mailto:support@nuvho.com">support@nuvho.com</a> if you need access.
        </p>

        <div className="login-links">
          <a href="https://nuvho.com" target="_blank" rel="noopener noreferrer">nuvho.com</a>
          <span>·</span>
          <a href="mailto:support@nuvho.com">Support</a>
          <span>·</span>
          <a href="https://knowledge.nuvho.com" target="_blank" rel="noopener noreferrer">Knowledge Base</a>
        </div>

        <p className="login-footer">© Nuvho Systems Pty Ltd</p>
      </div>

      <style jsx>{`
        /* Hairline used across onboarding's auth surfaces — brand-200. */
        .login-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 16px;
          background: var(--nv-surface-page);
        }

        .login-col {
          width: 100%;
          max-width: 420px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .login-logo {
          display: flex;
          justify-content: center;
          margin-bottom: 12px;
        }

        /* ── Card ── */
        .login-card {
          background: var(--nv-surface-card);
          border: 1px solid #b8d8e0;
          border-radius: 16px;
          box-shadow: var(--nv-shadow-sm);
          padding: 28px;
        }
        .login-card__title {
          font-family: var(--font-comfortaa);
          font-weight: 600;
          font-size: 14px;
          color: var(--nv-text-heading);
          margin-bottom: 4px;
        }
        .login-card__sub {
          font-size: 12px;
          color: #9AACAD;
          margin-bottom: 20px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .login-field label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          color: var(--nv-text-muted);
          margin-bottom: 6px;
        }
        .login-field input {
          width: 100%;
          border: 1px solid #b8d8e0;
          border-radius: 10px;
          padding: 10px 12px;
          font-family: var(--font-raleway);
          font-size: 14px;
          color: var(--nv-text-body);
          background: var(--nv-surface-page);
          outline: none;
          transition: border-color var(--nv-dur) var(--nv-ease),
                      box-shadow var(--nv-dur) var(--nv-ease);
        }
        .login-field input::placeholder { color: #9AACAD; }
        .login-field input:focus {
          border-color: transparent;
          box-shadow: 0 0 0 2px var(--nv-steel-blue);
        }
        .login-field input:disabled { opacity: 0.6; cursor: not-allowed; }

        .login-error {
          font-size: 12px;
          color: var(--nv-error);
          background: rgba(152,38,73,0.07);
          border: 1px solid rgba(152,38,73,0.2);
          border-radius: 10px;
          padding: 10px 12px;
          line-height: 1.5;
        }

        .login-submit {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: none;
          cursor: pointer;
          background: var(--nv-blue-slate);
          color: white;
          padding: 11px 24px;
          border-radius: var(--nv-radius-pill);
          font-family: var(--font-comfortaa);
          font-weight: 600;
          font-size: 14px;
          transition: background-color var(--nv-dur) var(--nv-ease),
                      opacity var(--nv-dur) var(--nv-ease);
        }
        .login-submit:hover:not(:disabled) { background: var(--nv-steel-blue); }
        .login-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Divider ── */
        .login-divider {
          position: relative;
          display: flex;
          justify-content: center;
        }
        .login-divider::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          border-top: 1px solid #b8d8e0;
        }
        .login-divider span {
          position: relative;
          background: var(--nv-surface-page);
          padding: 0 12px;
          font-family: var(--font-comfortaa);
          font-size: 11px;
          color: #9AACAD;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        /* ── Microsoft button ── */
        .login-ms-btn {
          width: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: var(--nv-surface-card);
          border: 1px solid #b8d8e0;
          border-radius: var(--nv-radius-pill);
          padding: 12px 16px;
          font-family: var(--font-comfortaa);
          font-weight: 600;
          font-size: 14px;
          color: var(--nv-iron-grey);
          box-shadow: var(--nv-shadow-sm);
          cursor: pointer;
          transition: background-color var(--nv-dur) var(--nv-ease),
                      opacity var(--nv-dur) var(--nv-ease);
        }
        .login-ms-btn:hover:not(:disabled) { background: #EDF4F6; }
        .login-ms-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Meta ── */
        .login-remember {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 13px;
          color: var(--nv-text-muted);
          cursor: pointer;
          user-select: none;
        }
        .login-remember input[type='checkbox'] {
          width: 15px;
          height: 15px;
          accent-color: var(--nv-blue-slate);
          cursor: pointer;
        }
        .login-remember input[type='checkbox']:disabled { cursor: not-allowed; }

        .login-note {
          font-size: 12px;
          color: var(--nv-text-muted);
          text-align: center;
          line-height: 1.6;
        }
        .login-note strong { color: var(--nv-text-body); }
        .login-note a { color: var(--nv-steel-blue); text-decoration: none; }
        .login-note a:hover { text-decoration: underline; }

        .login-links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          color: var(--nv-text-muted);
        }
        .login-links a {
          color: var(--nv-text-muted);
          text-decoration: none;
          transition: color var(--nv-dur);
        }
        .login-links a:hover { color: var(--nv-steel-blue); }

        .login-footer {
          text-align: center;
          font-size: 11px;
          color: #9AACAD;
          padding-top: 4px;
        }
      `}</style>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="10" height="10" fill="#F25022" />
      <rect x="11" width="10" height="10" fill="#7FBA00" />
      <rect y="11" width="10" height="10" fill="#00A4EF" />
      <rect x="11" y="11" width="10" height="10" fill="#FFB900" />
    </svg>
  )
}

function LoadingSpinner({ tone = 'white' }: { tone?: 'white' | 'teal' }) {
  const track = tone === 'teal' ? 'rgba(40,104,127,0.25)' : 'rgba(255,255,255,0.3)'
  const arc   = tone === 'teal' ? '#28687F' : 'white'
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"
      style={{ animation: 'nv-login-spin 0.8s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes nv-login-spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="9" cy="9" r="7" stroke={track} strokeWidth="2" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke={arc} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
