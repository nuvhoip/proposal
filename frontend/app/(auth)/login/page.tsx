'use client'

import React, { useState } from 'react'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'

export default function LoginPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const handleMicrosoftLogin = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // Redirect to Azure AD login
      const tenantId  = process.env.NEXT_PUBLIC_AZURE_TENANT_ID
      const clientId  = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID
      const appUrl    = process.env.NEXT_PUBLIC_APP_URL || window.location.origin
      const redirectUri = encodeURIComponent(`${appUrl}/auth/callback`)
      const scope       = encodeURIComponent('openid profile email User.Read')
      const state       = encodeURIComponent(btoa(JSON.stringify({ nonce: crypto.randomUUID(), returnTo: '/dashboard' })))

      const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize` +
        `?client_id=${clientId}` +
        `&response_type=code` +
        `&redirect_uri=${redirectUri}` +
        `&scope=${scope}` +
        `&state=${state}` +
        `&prompt=login`

      window.location.href = authUrl
    } catch {
      setError('Unable to initiate sign-in. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="login-root">
      {/* Left panel — brand */}
      <div className="login-brand">
        <div className="login-brand__inner">
          <NuvhoLogo variant="white" width={200} />

          <div className="login-brand__hero">
            <h1>Proposal System</h1>
            <p>
              Generate, send, and track client proposals from one place.
              Automated workflows handle the rest.
            </p>
          </div>

          <div className="login-brand__features">
            <FeatureItem icon="📄" text="Multi-service proposals in minutes" />
            <FeatureItem icon="✍️" text="Digital signing with audit trail" />
            <FeatureItem icon="🔄" text="Auto-triggers HubSpot, Asana & Xero" />
            <FeatureItem icon="📊" text="Live view tracking & buying signals" />
          </div>

          <div className="login-brand__footer">
            <span>© Nuvho Systems Pty Ltd</span>
          </div>
        </div>

        {/* Decorative circles */}
        <div className="login-brand__circle login-brand__circle--1" />
        <div className="login-brand__circle login-brand__circle--2" />
        <div className="login-brand__circle login-brand__circle--3" />
      </div>

      {/* Right panel — sign in */}
      <div className="login-form-panel">
        <div className="login-form-card animate-fade-in-up">
          {/* Mobile logo */}
          <div className="login-form-card__mobile-logo">
            <NuvhoLogo variant="primary" height={36} />
          </div>

          <div className="login-form-card__header">
            <h2>Welcome back</h2>
            <p>Sign in with your Nuvho Microsoft account to continue.</p>
          </div>

          {error && (
            <div className="login-error" role="alert">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#982649" strokeWidth="1.5"/>
                <path d="M8 4.5v4M8 10.5v1" stroke="#982649" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {error}
            </div>
          )}

          <button
            className="nv-btn nv-btn--solid nv-btn--lg login-ms-btn"
            onClick={handleMicrosoftLogin}
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <LoadingSpinner />
                Signing in…
              </>
            ) : (
              <>
                <MicrosoftIcon />
                Sign in with Microsoft
              </>
            )}
          </button>

          <p className="login-form-card__note">
            Only <strong>@nuvho.com</strong> accounts are authorised.
            Contact <a href="mailto:support@nuvho.com">support@nuvho.com</a> if you need access.
          </p>

          <div className="login-form-card__divider" />

          <div className="login-form-card__links">
            <a href="https://nuvho.com" target="_blank" rel="noopener noreferrer">nuvho.com</a>
            <span>·</span>
            <a href="mailto:support@nuvho.com">Support</a>
            <span>·</span>
            <a href="https://knowledge.nuvho.com" target="_blank" rel="noopener noreferrer">Knowledge Base</a>
          </div>
        </div>
      </div>

      <style jsx>{`
        .login-root {
          display: flex;
          min-height: 100vh;
          background: var(--nv-surface-page);
        }

        /* ── Brand panel ── */
        .login-brand {
          flex: 0 0 50%;
          background: var(--nv-surface-dark);
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: stretch;
          min-height: 100vh;
        }
        @media (max-width: 900px) { .login-brand { display: none; } }

        .login-brand__inner {
          position: relative;
          z-index: 2;
          padding: 48px;
          display: flex;
          flex-direction: column;
          gap: 0;
          width: 100%;
        }

        .login-brand__hero {
          margin-top: auto;
          padding-bottom: 40px;
        }
        .login-brand__hero h1 {
          font-family: var(--font-comfortaa);
          font-size: 42px;
          font-weight: 700;
          color: white;
          line-height: 1.1;
          margin-bottom: 16px;
        }
        .login-brand__hero p {
          font-family: var(--font-raleway);
          font-size: 16px;
          color: rgba(255,255,255,0.75);
          line-height: 1.65;
          max-width: 380px;
        }

        .login-brand__features {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 48px;
        }

        .login-brand__footer {
          margin-top: auto;
          font-family: var(--font-raleway);
          font-size: 12px;
          color: rgba(255,255,255,0.45);
        }

        /* Decorative circles */
        .login-brand__circle {
          position: absolute;
          border-radius: 50%;
          background: rgba(128,185,191,0.12);
          pointer-events: none;
        }
        .login-brand__circle--1 { width: 420px; height: 420px; top: -80px; right: -120px; }
        .login-brand__circle--2 { width: 280px; height: 280px; bottom: 80px; left: -60px; background: rgba(128,185,191,0.08); }
        .login-brand__circle--3 { width: 160px; height: 160px; top: 50%; right: 60px; background: rgba(128,185,191,0.07); }

        /* ── Form panel ── */
        .login-form-panel {
          width: 50%;
          min-width: 340px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          background: var(--nv-surface-page);
        }
        @media (max-width: 900px) {
          .login-form-panel { width: 100%; }
        }

        .login-form-card {
          width: 100%;
          max-width: 400px;
          background: var(--nv-surface-card);
          border-radius: var(--nv-radius-md);
          border: 1px solid var(--nv-border-hair);
          box-shadow: var(--nv-shadow-md);
          padding: 40px 36px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .login-form-card__mobile-logo {
          display: none;
          justify-content: center;
          padding-bottom: 4px;
        }
        @media (max-width: 900px) {
          .login-form-card__mobile-logo { display: flex; }
        }

        .login-form-card__header h2 {
          font-family: var(--font-comfortaa);
          font-size: 26px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin-bottom: 6px;
        }
        .login-form-card__header p {
          font-size: 14px;
          color: var(--nv-text-muted);
          line-height: 1.55;
        }

        .login-error {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 14px;
          background: rgba(152,38,73,0.07);
          border: 1px solid rgba(152,38,73,0.2);
          border-radius: 10px;
          color: var(--nv-error);
          font-size: 13px;
          font-weight: 500;
        }

        .login-ms-btn {
          width: 100%;
          justify-content: center;
          gap: 10px;
          padding: 14px 28px !important;
          font-size: 15px;
          transition: padding var(--nv-dur) var(--nv-ease),
                      background var(--nv-dur) var(--nv-ease);
        }
        .login-ms-btn:hover:not(:disabled) {
          padding-left: 28px !important;
          padding-right: 28px !important;
        }

        .login-form-card__note {
          font-size: 12px;
          color: var(--nv-text-muted);
          text-align: center;
          line-height: 1.6;
        }
        .login-form-card__note strong { color: var(--nv-text-body); }
        .login-form-card__note a {
          color: var(--nv-steel-blue);
          text-decoration: none;
        }
        .login-form-card__note a:hover { text-decoration: underline; }

        .login-form-card__divider {
          height: 1px;
          background: var(--nv-border-hair);
        }

        .login-form-card__links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 12px;
          color: var(--nv-text-muted);
        }
        .login-form-card__links a {
          color: var(--nv-text-muted);
          text-decoration: none;
          transition: color var(--nv-dur);
        }
        .login-form-card__links a:hover { color: var(--nv-steel-blue); }
      `}</style>
    </div>
  )
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 14px',
      background: 'rgba(255,255,255,0.08)',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{
        fontFamily: 'var(--font-raleway)',
        fontSize: '14px',
        color: 'rgba(255,255,255,0.85)',
        fontWeight: 500,
      }}>{text}</span>
    </div>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="1" y="1"  width="8.5" height="8.5" fill="#F25022"/>
      <rect x="10.5" y="1"  width="8.5" height="8.5" fill="#7FBA00"/>
      <rect x="1" y="10.5" width="8.5" height="8.5" fill="#00A4EF"/>
      <rect x="10.5" y="10.5" width="8.5" height="8.5" fill="#FFB900"/>
    </svg>
  )
}

function LoadingSpinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
      <path d="M9 2a7 7 0 0 1 7 7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
