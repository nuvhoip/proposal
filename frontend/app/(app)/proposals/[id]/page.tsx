'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Proposal } from '@/lib/types'
import { buildDocModelFromProposal } from '@/lib/documentModel'
import { ProposalDocument } from '@/components/proposal/ProposalDocument'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

const SERVICE_LABELS: Record<string, string> = {
  RM: 'Revenue Management',
  SM: 'Social Media',
  MK: 'Marketing',
  CR: 'Corporate Rate',
}
const STATUS_CLASSES: Record<string, string> = {
  draft:        'nv-badge--draft',
  generated:    'nv-badge--generated',
  sent:         'nv-badge--sent',
  signed:       'nv-badge--signed',
  fully_signed: 'nv-badge--fully_signed',
  expired:      'nv-badge--expired',
  pending:      'nv-badge--pending',
}

// Sentence-case status labels (badges are never letterspaced caps)
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', generated: 'Generated', sent: 'Sent', signed: 'Signed',
  fully_signed: 'Fully signed', expired: 'Expired', pending: 'Pending',
}

type AuditEntry = { id: string; event: string; actor: string; meta: string | null; created_at: string }

// Shape written by worker/src/routes/proposals.ts's getPublicProposal() into
// audit_log.meta for 'viewed' / 'link_previewed' events (JSON-encoded).
type ViewMeta = {
  ip?: string | null
  userAgent?: string | null
  browser?: string
  os?: string
  deviceType?: string
  referer?: string | null
  country?: string | null
  region?: string | null
  city?: string | null
  timezone?: string | null
}

function parseViewMeta(raw: string | null): ViewMeta | null {
  if (!raw) return null
  try { return JSON.parse(raw) as ViewMeta } catch { return null }
}

function formatViewLocation(m: ViewMeta): string {
  const place = [m.city, m.region, m.country].filter(Boolean).join(', ')
  return place || 'Unknown location'
}

export default function ProposalDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()

  const [proposal, setProposal] = useState<any>(null)
  const [audit,    setAudit]    = useState<AuditEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [deleting, setDeleting] = useState(false)
  const [copied,   setCopied]   = useState<string | null>(null)
  const [showDoc,  setShowDoc]  = useState(false)
  const [exporting, setExporting] = useState<'pdf' | null>(null)

  // Resend — lets staff re-send the signing-link email for a proposal
  // that's already gone out, editing To/CC/BCC first (e.g. adding a
  // stakeholder who was missed, or retrying after a failed send).
  const [showResend,   setShowResend]   = useState(false)
  const [resendTo,     setResendTo]     = useState('')
  const [resendCc,     setResendCc]     = useState('')
  const [resendBcc,    setResendBcc]    = useState('')
  const [resending,    setResending]    = useState(false)
  const [resendError,  setResendError]  = useState('')
  const [resendNotice, setResendNotice] = useState('')

  async function copyToClipboard(text: string, which: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        // Fallback for non-secure contexts / older browsers where
        // navigator.clipboard is undefined and writeText would throw.
        const el = document.createElement('textarea')
        el.value = text
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.focus()
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(which)
      setTimeout(() => setCopied(null), 2000)
    } catch (e) {
      console.error('Copy failed:', e)
      alert('Could not copy to clipboard. Please copy it manually.')
    }
  }

  // Same staleness problem as the list page (proposals/page.tsx): this only
  // ever fetched once on mount, so signing a proposal on its public
  // /p/{token} page (opened via Copy Link, often in its own tab) never
  // showed up here — status stayed "draft" and the Expires row stayed on
  // its original value even though the worker's signProposal() had already
  // updated the D1 row. Re-fetching on tab focus/visibility fixes that
  // without needing a manual hard refresh.
  useEffect(() => {
    if (!id) return

    function loadProposal() {
      Promise.all([
        fetch(`${WORKER}/proposals/${id}`, { credentials: 'include' }),
        fetch(`${WORKER}/proposals/${id}/audit`, { credentials: 'include' }),
      ])
        .then(async ([pRes, aRes]) => {
          if (!pRes.ok) throw new Error('Proposal not found')
          const [pJson, aJson] = await Promise.all([pRes.json(), aRes.json()])
          setProposal(pJson.data)
          setAudit(aJson.data || [])
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }

    loadProposal()

    function onVisible() {
      if (document.visibilityState === 'visible') loadProposal()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', loadProposal)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', loadProposal)
    }
  }, [id])


  function openResendModal() {
    setResendTo(proposal?.contact_email || '')
    setResendCc(proposal?.sender_cc || '')
    setResendBcc(proposal?.sender_bcc || '')
    setResendError('')
    setResendNotice('')
    setShowResend(true)
  }

  async function handleResend() {
    if (!resendTo.trim()) { setResendError('At least one recipient (To) is required'); return }
    setResending(true)
    setResendError('')
    try {
      const res = await fetch(`${WORKER}/proposals/${id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ to: resendTo, cc: resendCc, bcc: resendBcc }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to resend proposal')
      setProposal((p: any) => ({ ...p, sender_cc: resendCc, sender_bcc: resendBcc }))
      setResendNotice(`Sent to ${resendTo}`)
      // Refresh the activity log so the new "resent" entry shows up immediately.
      fetch(`${WORKER}/proposals/${id}/audit`, { credentials: 'include' })
        .then(r => r.json()).then(j => setAudit(j.data || [])).catch(() => {})
      window.setTimeout(() => setShowResend(false), 1200)
    } catch (e: any) {
      setResendError(e.message)
    } finally {
      setResending(false)
    }
  }

  // Restricted to draft proposals — mirrors the backend's deleteProposal()
  // check (409 for anything else), which mirrors the existing Edit/Send
  // (canSend) gate: a sent or signed proposal is a real record, not
  // something to silently erase.
  async function handleDelete() {
    if (!confirm(
      `Permanently delete the proposal for ${proposal?.hotel_name}? This cannot be undone.`
    )) return
    setDeleting(true)
    try {
      const res = await fetch(`${WORKER}/proposals/${id}`, {
        method: 'DELETE', credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to delete proposal')
      router.push('/proposals')
    } catch (e: any) {
      alert('Failed to delete: ' + e.message)
      setDeleting(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
      <div className="nv-spinner" />
    </div>
  )

  if (error || !proposal) return (
    <div style={{ padding: 32, color: 'var(--nv-cherry-rose)' }}>
      {error || 'Proposal not found'}
    </div>
  )

  const totalMRR = (proposal.services || []).reduce(
    (a: number, s: any) => a + (s.monthly_fee || 0), 0
  )
  const totalSetup = (proposal.services || []).reduce(
    (a: number, s: any) => a + (s.setup_fee || 0), 0
  )
  const totalContract = (proposal.services || []).reduce(
    (a: number, s: any) => a + (s.monthly_fee || 0) * (s.term_months || 12) + (s.setup_fee || 0), 0
  )

  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL}/p/${proposal.signing_token}`
  const canSend   = proposal.status === 'draft'
  // NUVCL-126: PDF download only available once the client has signed
  // (signature capture / approval, per NUVCL-105) — Word download removed entirely.
  const canDownloadPdf = proposal.status === 'signed' || proposal.status === 'fully_signed'
  const docModel  = buildDocModelFromProposal(proposal)

  const handleDownloadPdf = () => {
    setShowDoc(true)
    setExporting('pdf')
    // Print-to-PDF: @media print (globals.css) hides everything except
    // #proposal-print-root, which <ProposalDocument> renders into.
    window.setTimeout(() => window.print(), 50)
    window.setTimeout(() => setExporting(null), 600)
  }

  return (
    <div className="nv-page detail-page">

      {/* Header */}
      <div className="nv-page-header">
        <div style={{ minWidth: 240 }}>
          <button
            onClick={() => router.push('/proposals')}
            className="nv-btn nv-btn--ghost nv-btn--sm detail-back"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/arrow-left.svg" width={14} height={14} alt="" className="nv-icon-inline" /> Back to proposals
          </button>
          <h1 className="nv-page-title">
            {proposal.hotel_name}
          </h1>
          <p className="nv-page-subtitle">
            {proposal.region?.toUpperCase()} · Created {new Date(proposal.created_at).toLocaleDateString('en-AU')}
          </p>
          <button
            onClick={() => copyToClipboard(proposal.prop_id || proposal.np_id || proposal.id, 'id')}
            title="Click to copy the proposal ID"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                     marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span className="detail-id-chip">
              {proposal.prop_id || proposal.np_id || proposal.id}
            </span>
            <span style={{ fontSize: 11, color: copied === 'id' ? 'var(--nv-success)' : 'var(--nv-blue-slate)',
                           fontWeight: copied === 'id' ? 600 : 400 }}>
              {copied === 'id' ? 'Copied' : 'Copy'}
            </span>
          </button>

          {!proposal.prop_id && proposal.prop_id_sync_error && (
            <div style={{ fontSize: 11, color: 'var(--nv-text-muted)', marginTop: 4 }}>
              Proposal ID not yet created — {proposal.prop_id_sync_error}
            </div>
          )}

          {/* Engagement ID (EID) — the registry-issued ENG-{GEO}-{SVC}-{YYYY}-
              {SEQ4} id, one per bundled service line, distinct from the
              Proposal ID (prop_id) above — that one is the Master Registry's
              PROP-{GEO}-{YYYY}-{SEQ4} record, shared across every bundled
              service line. Only exists once a registered property (pid) is
              linked to this proposal — see worker/src/routes/proposals.ts's
              createProposal for why a service can come back with no eid. */}
          {Array.isArray(proposal.registryLinks) && proposal.registryLinks.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {proposal.registryLinks.map((link: any) => (
                link.eid ? (
                  <button
                    key={link.service_line}
                    onClick={() => copyToClipboard(link.eid, `eid-${link.service_line}`)}
                    title="Click to copy the engagement ID (EID)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                             display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <span className="detail-id-chip">
                      EID ({link.service_line}) {link.eid}
                    </span>
                    <span style={{ fontSize: 11,
                                   color: copied === `eid-${link.service_line}` ? 'var(--nv-success)' : 'var(--nv-blue-slate)',
                                   fontWeight: copied === `eid-${link.service_line}` ? 600 : 400 }}>
                      {copied === `eid-${link.service_line}` ? 'Copied' : 'Copy'}
                    </span>
                  </button>
                ) : (
                  <span key={link.service_line} style={{ fontSize: 11, color: 'var(--nv-text-muted)' }}>
                    Engagement ID ({link.service_line}): not yet created
                    {link.eid_sync_error ? ` — ${link.eid_sync_error}` : ''}
                  </span>
                )
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span className={`nv-badge ${STATUS_CLASSES[proposal.status] || ''}`}>
            {STATUS_LABELS[proposal.status] || proposal.status}
          </span>
          {/* NUVCL-126: PDF gated to signed proposals only; Word download removed. */}
          {canDownloadPdf && (
            <button
              className="nv-btn nv-btn--ghost"
              onClick={handleDownloadPdf}
              disabled={exporting !== null}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/download.svg" width={14} height={14} alt="" className="nv-icon-inline" />{exporting === 'pdf' ? 'Preparing…' : 'PDF'}
            </button>
          )}
          {/* NUVCL-99: Copy Link promoted from the "Signing Link" card at the
              bottom of the page up into the top action bar (that card is
              removed below) so staff don't have to scroll to grab the link. */}
          {proposal.signing_token && (
            <button
              className="nv-btn nv-btn--ghost"
              onClick={() => copyToClipboard(publicUrl, 'link')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/link-simple.svg" width={14} height={14} alt="" className="nv-icon-inline" />{copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
          )}
          {/* NUVCL-99: renamed from "View Public Page ↗" to "View ↗" */}
          {proposal.status === 'sent' && (
            <a href={publicUrl} target="_blank" rel="noreferrer"
               className="nv-btn nv-btn--secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/arrow-up-right-from-square.svg" width={14} height={14} alt="" />
              View
            </a>
          )}
          {canSend && (
            <Link href={`/proposals/new?edit=${proposal.id}`}
                  className="nv-btn nv-btn--secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/pen.svg" width={14} height={14} alt="" />
              Edit
            </Link>
          )}
          {canSend && (
            <button
              className="nv-btn nv-btn--danger"
              onClick={handleDelete}
              disabled={deleting}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/trash-can.svg" width={14} height={14} alt="" style={{ filter: 'brightness(0) invert(1)' }} />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          )}
          {proposal.sent_at && (
            <button
              className="nv-btn nv-btn--secondary"
              onClick={openResendModal}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/arrows-rotate.svg" width={14} height={14} alt="" />
              Resend
            </button>
          )}
        </div>
      </div>

      {/* Resend modal */}
      {showResend && (
        <div className="resend-modal-overlay" onMouseDown={() => !resending && setShowResend(false)}>
          <div className="resend-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="resend-modal__header">
              <h3>Resend proposal</h3>
              <button type="button" className="resend-modal__close" aria-label="Close"
                      onClick={() => setShowResend(false)}>
                ×
              </button>
            </div>
            <div className="resend-modal__body">
              <p className="resend-modal__hint">
                Re-sends the signing-link email for this proposal. Recipients below are
                pre-filled from the original send — edit them to add or remove anyone
                before sending.
              </p>
              <div className="resend-modal__field">
                <label className="resend-modal__label">To *</label>
                <input className="nv-input" value={resendTo}
                       onChange={e => setResendTo(e.target.value)}
                       placeholder="client@example.com" />
              </div>
              <div className="resend-modal__field">
                <label className="resend-modal__label">CC</label>
                <input className="nv-input" value={resendCc}
                       onChange={e => setResendCc(e.target.value)}
                       placeholder="comma-separated addresses" />
              </div>
              <div className="resend-modal__field">
                <label className="resend-modal__label">BCC</label>
                <input className="nv-input" value={resendBcc}
                       onChange={e => setResendBcc(e.target.value)}
                       placeholder="comma-separated addresses" />
              </div>
              {resendError && (
                <p style={{ color: 'var(--nv-error)', fontSize: 13, margin: 0 }}>{resendError}</p>
              )}
              {resendNotice && (
                <p style={{ color: 'var(--nv-success)', fontSize: 13, margin: 0 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/circle-check.svg" width={14} height={14} alt="" className="nv-icon-inline" /> {resendNotice}</p>
              )}
            </div>
            <div className="resend-modal__footer">
              <button className="nv-btn nv-btn--secondary"
                      onClick={() => setShowResend(false)} disabled={resending}>
                Cancel
              </button>
              <button className="nv-btn nv-btn--primary"
                      onClick={handleResend} disabled={resending}>
                {resending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="detail-grid">
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Contact */}
          <div className="nv-card" style={{ padding: 24 }}>
            <h2 className="nv-card__title detail-card__title">
              Contact
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Name"    value={proposal.contact_name} />
              <Field label="Title"   value={proposal.contact_title || '—'} />
              <Field label="Email"   value={proposal.contact_email} />
              <Field label="Phone"   value={proposal.contact_phone || '—'} />
              <Field label="Address" value={proposal.property_address || '—'} style={{ gridColumn: '1 / -1' }} />
            </div>
          </div>

          {/* Services */}
          <div className="nv-card" style={{ padding: 24 }}>
            <h2 className="nv-card__title detail-card__title">
              Services
            </h2>
            <div className="detail-table-wrap">
            <table className="nv-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="nv-num">Monthly</th>
                  <th className="nv-num">Setup</th>
                  <th className="nv-num">Term</th>
                </tr>
              </thead>
              <tbody>
                {(proposal.services || []).map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <span className="detail-service-tag">{s.code}</span>
                      {SERVICE_LABELS[s.code] || s.code}
                    </td>
                    <td className="nv-num">${s.monthly_fee.toLocaleString()}</td>
                    <td className="nv-num">${s.setup_fee.toLocaleString()}</td>
                    <td className="nv-num">{s.term_months}m</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="nv-num detail-table__total">
                    Total contract value: ${totalContract.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
            </div>
          </div>

          {/* Sender message */}
          {proposal.sender_message && (
            <div className="nv-card" style={{ padding: 24,
                                              borderLeft: '3px solid var(--nv-tropical-teal)' }}>
              <h2 className="nv-card__title detail-card__title">
                Personal message
              </h2>
              {/* sender_message is rich HTML from the wizard's RichTextEditor
                  (same field lib/documentModel.ts feeds into the generated
                  document's introMessage, rendered via dangerouslySetInnerHTML
                  there too) — interpolating it as plain text showed the raw
                  <p> tags instead of rendering them. */}
              <div className="sender-message-rich"
                style={{ color: 'var(--nv-text-body)', lineHeight: 1.6,
                          fontStyle: 'italic', fontSize: 15 }}
                dangerouslySetInnerHTML={{ __html: proposal.sender_message }} />
              {proposal.sender && (
                <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--nv-text-muted)' }}>
                  — {proposal.sender.name}, {proposal.sender.role}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Value summary */}
          <div className="nv-card nv-on-dark" style={{ padding: 24,
                                            background: 'var(--nv-surface-dark)', borderColor: 'rgba(255,255,255,0.16)' }}>
            <h2 className="nv-card__title detail-card__title detail-card__title--on-dark">
              Proposal value
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ValueRow label="Monthly retainer" value={`$${totalMRR.toLocaleString()}`} />
              <ValueRow label="Setup fees" value={`$${totalSetup.toLocaleString()}`} />
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 12 }} />
              <ValueRow label="Total contract"
                value={`$${totalContract.toLocaleString()}`}
                highlight />
            </div>
          </div>

          {/* Timeline */}
          <div className="nv-card" style={{ padding: 24 }}>
            <h2 className="nv-card__title detail-card__title">
              Timeline
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <TimelineRow label="Created"    date={proposal.created_at} />
              <TimelineRow label="Sent"       date={proposal.sent_at} />
              <TimelineRow label="Expires"    date={proposal.expires_at} />
              <TimelineRow label="Signed"     date={proposal.signed_at} />
              {proposal.signer_name && (
                <div style={{ fontSize: 13, color: 'var(--nv-text-muted)', paddingLeft: 16 }}>
                  Signed by: <strong style={{ color: 'var(--nv-success)' }}>
                    {proposal.signer_name}
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* Audit log — milestone events only (view-tracking now lives in
              its own "Link Views" card below so per-open noise doesn't bury
              created/sent/signed history). */}
          {(() => {
            const milestoneAudit = audit.filter(e => e.event !== 'viewed' && e.event !== 'link_previewed')
            return milestoneAudit.length > 0 && (
              <div className="nv-card" style={{ padding: 24 }}>
                <h2 className="nv-card__title detail-card__title">
                  Activity log
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {milestoneAudit.slice(0, 10).map(e => (
                    <div key={e.id} style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 600, color: 'var(--nv-blue-slate)',
                                     textTransform: 'capitalize' }}>
                        {e.event}
                      </span>
                      <span style={{ color: 'var(--nv-text-muted)' }}> · {e.actor}</span>
                      <br />
                      <span style={{ color: 'var(--nv-text-muted)', fontSize: 11 }}>
                        {new Date(e.created_at).toLocaleString('en-AU')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* NUVCL: Link Views — detailed per-open analytics for the public
              Copy Link (timestamp, IP, browser/OS/device, and Cloudflare
              edge-derived geolocation). Bot/link-preview opens (Slack, Teams,
              Outlook Safe Links, etc.) are logged separately as
              'link_previewed' and summarized rather than listed one-by-one,
              so the list here stays meaningful to a human reading it. */}
          {(() => {
            const viewEvents = audit.filter(e => e.event === 'viewed')
            const previewCount = audit.filter(e => e.event === 'link_previewed').length
            if (viewEvents.length === 0 && previewCount === 0) return null
            return (
              <div className="nv-card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <h2 className="nv-card__title detail-card__title">
                    Link views
                  </h2>
                  <span style={{ fontSize: 12, color: 'var(--nv-text-muted)' }}>
                    {proposal.viewCount ?? viewEvents.length} total
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {viewEvents.slice(0, 15).map(e => {
                    const meta = parseViewMeta(e.meta)
                    return (
                      <div key={e.id} style={{ fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: 'var(--nv-blue-slate)' }}>
                          {meta ? formatViewLocation(meta) : 'Unknown location'}
                        </span>
                        <span style={{ color: 'var(--nv-text-muted)' }}>
                          {' '}· {meta?.ip || 'unknown IP'}
                        </span>
                        {meta && (meta.browser || meta.os || meta.deviceType) && (
                          <>
                            <br />
                            <span style={{ color: 'var(--nv-text-muted)', fontSize: 12 }}>
                              {[meta.browser, meta.os, meta.deviceType].filter(Boolean).join(' · ')}
                            </span>
                          </>
                        )}
                        <br />
                        <span style={{ color: 'var(--nv-text-muted)', fontSize: 11 }}>
                          {new Date(e.created_at).toLocaleString('en-AU')}
                        </span>
                      </div>
                    )
                  })}
                  {previewCount > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--nv-text-muted)', fontStyle: 'italic' }}>
                      +{previewCount} link preview{previewCount === 1 ? '' : 's'} by chat/email apps (not shown individually)
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* NUVCL-99: the "Signing Link" card that used to live here was
              removed — Copy Link now lives in the top action bar instead of
              being duplicated in both places. */}
        </div>
      </div>

      {/* Document Preview */}
      <div className="nv-card" style={{ padding: 24, marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 className="nv-card__title">
            Document preview
          </h2>
          <button
            className="nv-btn nv-btn--ghost nv-btn--sm"
            onClick={() => setShowDoc(v => !v)}
          >
            {showDoc ? 'Hide' : 'Show'}
          </button>
        </div>
        {showDoc && (
          <div style={{ marginTop: 16 }}>
            <ProposalDocument model={docModel} />
          </div>
        )}
      </div>

      <style jsx>{`
        .sender-message-rich :global(p) { margin: 0 0 10px; }
        .sender-message-rich :global(p:last-child) { margin-bottom: 0; }
        .sender-message-rich :global(ul), .sender-message-rich :global(ol) { margin: 0 0 10px 20px; }
        /* Modal — browser-app-shell §9: overlay rgba(30,40,45,.45), white panel r14,
           max 520, header 24 28 + hairline, title Comfortaa 500 22, 32×32 xmark close */
        .resend-modal-overlay {
          position: fixed; inset: 0; background: var(--nv-overlay);
          display: flex; align-items: center; justify-content: center;
          z-index: 300; padding: 24px;
        }
        .resend-modal {
          background: #FFFFFF; border-radius: 14px; width: 100%; max-width: 520px; max-height: calc(100vh - 48px); overflow-y: auto;
        }
        .resend-modal__header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 24px 28px; border-bottom: 1px solid var(--nv-border-hair);
        }
        .resend-modal__header h3 {
          margin: 0; font: 500 22px/1.25 var(--nv-font-display);
          color: var(--nv-text-heading); letter-spacing: 0;
        }
        .resend-modal__close {
          width: 32px; height: 32px; border-radius: 6px; background: none; border: none; cursor: pointer;
          display: grid; place-content: center; padding: 0; font-size: 0;
        }
        .resend-modal__close::before { content: ""; width: 14px; height: 14px; background: url('/icons/xmark.svg') center / contain no-repeat; }
        .resend-modal__close:hover { background: rgba(40,104,127,0.08); }
        .resend-modal__body { padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }
        .resend-modal__field { display: flex; flex-direction: column; gap: 6px; }
        .resend-modal__label { font-size: 13px; font-weight: 500; color: var(--nv-text-body); }
        .resend-modal__hint { margin: 0; font-size: 13px; color: var(--nv-text-muted); line-height: 1.6; }
        .resend-modal__footer {
          display: flex; justify-content: flex-end; gap: 12px;
          padding: 16px 28px 24px;
        }

        /* Page layout */
        .detail-page :global(.detail-back) { margin: 0 0 8px -16px; }
        .detail-grid { display: grid; grid-template-columns: 1fr 360px; gap: 24px; }
        @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
        .detail-page :global(.detail-card__title) { margin: 0 0 16px; }
        .detail-page :global(.detail-card__title--on-dark) { color: #FFFFFF; }
        .detail-id-chip {
          font-family: var(--nv-font-mono); font-size: 12px; color: var(--nv-text-muted);
          background: var(--nv-wash-08); border-radius: 6px; padding: 2px 8px;
        }
        .detail-table-wrap { margin: 0 -24px -24px; border-top: 1px solid var(--nv-border-hair); overflow-x: auto; }
        .detail-service-tag {
          background: var(--nv-wash-08); border-radius: 6px; padding: 2px 8px; margin-right: 8px;
          font-size: 12px; font-weight: 500; color: var(--nv-blue-slate);
        }
        .detail-table__total { font: 600 15px/1.4 var(--nv-font-body); color: var(--nv-blue-slate); }
      `}</style>
    </div>
  )
}

function Field({ label, value, style }: { label: string; value: string; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--nv-text-muted)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--nv-text-body)', fontWeight: 500 }}>
        {value}
      </div>
    </div>
  )
}

function ValueRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>{label}</span>
      <span style={{
        fontSize:   highlight ? 28 : 15,
        fontWeight: highlight ? 700 : 600,
        color:      highlight ? 'var(--nv-tropical-teal)' : 'white',
        fontFamily: highlight ? 'var(--nv-font-display)' : 'var(--nv-font-body)',
      }}>
        {value}
      </span>
    </div>
  )
}

function TimelineRow({ label, date }: { label: string; date: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--nv-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 500, color: date ? 'var(--nv-text-body)' : 'var(--nv-text-muted)' }}>
        {date ? new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
      </span>
    </div>
  )
}
