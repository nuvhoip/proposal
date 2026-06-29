'use client'

import React, { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'
import type { Proposal } from '@/lib/types'

export default function PublicProposalPage() {
  const params = useParams<{ id: string }>()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [signing,  setSigning]  = useState(false)
  const [signed,   setSigned]   = useState(false)
  const [sigName,  setSigName]  = useState('')

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/p/${params.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setProposal(d.data)
        setSigned(d.data.status === 'signed')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.id])

  async function handleSign() {
    if (!sigName.trim()) return
    setSigning(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/p/${params.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: sigName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSigned(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSigning(false)
    }
  }

  if (loading) return <LoadingScreen />
  if (error || !proposal) return <ErrorScreen message={error || 'Proposal not found'} />

  const isExpired = proposal.status === 'expired' ||
    (proposal.expiresAt && new Date(proposal.expiresAt) < new Date())

  return (
    <div className="public-page">
      {/* Header */}
      <header className="public-header">
        <NuvhoLogo variant="white" height={38} />
        <div className="public-header__meta">
          <span className="public-header__ref">Proposal #{proposal.id.slice(0,8).toUpperCase()}</span>
          {proposal.expiresAt && (
            <span className="public-header__expiry">
              Valid until {new Date(proposal.expiresAt).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' })}
            </span>
          )}
        </div>
      </header>

      {/* Cover */}
      <div className="public-cover">
        <div className="public-cover__overlay" />
        <div className="public-cover__content">
          <div className="public-cover__prepared">Prepared for</div>
          <h1 className="public-cover__hotel">{proposal.hotelName}</h1>
          <p className="public-cover__attn">Attention: {proposal.contactName}</p>
          {proposal.validUntil && (
            <p className="public-cover__date">
              Valid until {new Date(proposal.validUntil).toLocaleDateString('en-AU', { day:'numeric', month:'long', year:'numeric' })}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="public-body">
        {/* Intro / Personal message */}
        {proposal.senderMessage && (
          <section className="public-section">
            <p className="public-intro">{proposal.senderMessage}</p>
          </section>
        )}

        {/* Services summary */}
        <section className="public-section">
          <h2 className="public-section-title">Proposed Services</h2>
          <div className="public-services">
            {/* Services rendered from proposal.services fetched separately */}
            <div className="public-services-placeholder">
              <p style={{ color: 'var(--nv-text-muted)', fontSize: 14 }}>
                Service details loaded from proposal data.
              </p>
            </div>
          </div>
        </section>

        {/* Signing section */}
        <section className="public-section public-sign-section">
          {signed ? (
            <div className="public-signed">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="var(--nv-success)" fillOpacity="0.1"/>
                <circle cx="24" cy="24" r="22" stroke="var(--nv-success)" strokeWidth="2"/>
                <path d="M14 24l7 7 13-13" stroke="var(--nv-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3>Proposal Accepted</h3>
              <p>Thank you for accepting this proposal. Our team will be in touch shortly to begin onboarding.</p>
            </div>
          ) : isExpired ? (
            <div className="public-expired">
              <h3>Proposal Expired</h3>
              <p>This proposal has expired. Please contact your Nuvho representative to receive an updated proposal.</p>
            </div>
          ) : (
            <div className="public-sign-form">
              <h2 className="public-section-title">Accept This Proposal</h2>
              <p style={{ fontSize: 14, color: 'var(--nv-text-muted)', marginBottom: 20 }}>
                By signing below, you acknowledge and accept the terms and services outlined in this proposal.
              </p>
              <div className="sign-input-row">
                <input
                  className="nv-input"
                  placeholder="Your full name"
                  value={sigName}
                  onChange={e => setSigName(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  className="nv-btn nv-btn--solid nv-btn--lg"
                  onClick={handleSign}
                  disabled={signing || !sigName.trim()}
                  aria-busy={signing}
                >
                  {signing ? 'Signing…' : 'Accept & Sign'}
                </button>
              </div>
              {error && (
                <p style={{ color: 'var(--nv-error)', fontSize: 13, marginTop: 8 }}>{error}</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <footer className="public-footer">
        <NuvhoLogo variant="white" height={32} />
        <span>© Nuvho Systems Pty Ltd · Smart Hoteliers</span>
      </footer>

      <style jsx>{`
        .public-page {
          min-height: 100vh;
          background: var(--nv-surface-page);
          display: flex;
          flex-direction: column;
        }

        /* Header */
        .public-header {
          background: var(--nv-surface-dark);
          padding: 16px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        @media (max-width: 600px) { .public-header { padding: 16px; } }
        .public-header__meta { text-align: right; }
        .public-header__ref  { font-size: 12px; color: rgba(255,255,255,0.6); display: block; }
        .public-header__expiry { font-size: 11px; color: rgba(255,255,255,0.45); }

        /* Cover */
        .public-cover {
          height: 340px;
          background: linear-gradient(135deg, #1E5163 0%, #28687F 60%, #80B9BF 100%);
          position: relative;
          display: flex;
          align-items: flex-end;
          padding: 48px 56px;
        }
        @media (max-width: 600px) { .public-cover { padding: 32px 20px; height: 260px; } }
        .public-cover__overlay {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.18);
          pointer-events: none;
        }
        .public-cover__content { position: relative; z-index: 1; }
        .public-cover__prepared {
          font-size: 13px;
          color: rgba(255,255,255,0.7);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 6px;
        }
        .public-cover__hotel {
          font-family: var(--font-comfortaa);
          font-size: 42px;
          font-weight: 700;
          color: white;
          line-height: 1.05;
          margin-bottom: 10px;
        }
        @media (max-width: 600px) { .public-cover__hotel { font-size: 28px; } }
        .public-cover__attn { color: rgba(255,255,255,0.8); font-size: 16px; }
        .public-cover__date { color: rgba(255,255,255,0.6); font-size: 13px; margin-top: 4px; }

        /* Body */
        .public-body {
          max-width: 820px;
          width: 100%;
          margin: 0 auto;
          padding: 48px 24px;
          flex: 1;
        }

        .public-section { margin-bottom: 48px; }
        .public-section-title {
          font-family: var(--font-comfortaa);
          font-size: 22px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin-bottom: 20px;
        }
        .public-intro {
          font-size: 16px;
          line-height: 1.75;
          color: var(--nv-text-body);
          border-left: 3px solid var(--nv-tropical-teal);
          padding-left: 20px;
        }

        .public-services-placeholder {
          padding: 24px;
          background: var(--nv-surface-card);
          border-radius: var(--nv-radius-md);
          border: 1px solid var(--nv-border-hair);
        }

        /* Signing */
        .public-sign-section {
          background: var(--nv-surface-card);
          border: 1px solid var(--nv-border-hair);
          border-radius: var(--nv-radius-md);
          padding: 36px;
          box-shadow: var(--nv-shadow-sm);
        }

        .sign-input-row {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        @media (max-width: 600px) {
          .sign-input-row { flex-direction: column; }
          .sign-input-row button { width: 100%; justify-content: center; }
        }

        .public-signed, .public-expired {
          text-align: center;
          padding: 20px;
        }
        .public-signed h3, .public-expired h3 {
          font-family: var(--font-comfortaa);
          font-size: 22px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin: 16px 0 8px;
        }
        .public-signed p, .public-expired p {
          color: var(--nv-text-muted);
          font-size: 14px;
          line-height: 1.6;
          max-width: 400px;
          margin: 0 auto;
        }

        /* Footer */
        .public-footer {
          background: var(--nv-surface-dark);
          padding: 24px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        @media (max-width: 600px) {
          .public-footer { padding: 20px 16px; flex-direction: column; gap: 8px; }
        }
        .public-footer span {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
        }
      `}</style>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:20, background:'var(--nv-surface-page)' }}>
      <NuvhoLogo variant="primary" height={40} />
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
        style={{ animation:'spin 0.8s linear infinite' }}>
        <style>{`@keyframes spin { to { transform:rotate(360deg); } }`}</style>
        <circle cx="18" cy="18" r="15" stroke="var(--nv-platinum)" strokeWidth="3"/>
        <path d="M18 3a15 15 0 0 1 15 15" stroke="var(--nv-blue-slate)" strokeWidth="3" strokeLinecap="round"/>
      </svg>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:16, background:'var(--nv-surface-page)', padding:24 }}>
      <NuvhoLogo variant="primary" height={40} />
      <h2 style={{ fontFamily:'var(--font-comfortaa)', color:'var(--nv-text-heading)', fontSize:22 }}>
        Proposal not found
      </h2>
      <p style={{ color:'var(--nv-text-muted)', fontSize:14, textAlign:'center', maxWidth:360 }}>
        {message}. Please check the link or contact your Nuvho representative.
      </p>
    </div>
  )
}
