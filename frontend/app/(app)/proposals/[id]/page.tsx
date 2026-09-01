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
  draft:   'nv-badge--draft',
  sent:    'nv-badge--sent',
  signed:  'nv-badge--signed',
  expired: 'nv-badge--expired',
  pending: 'nv-badge--pending',
}

type AuditEntry = { id: string; event: string; actor: string; meta: string | null; created_at: string }

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
    <div style={{ padding: '32px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: 16, marginBottom: 32 }}>
        <div style={{ minWidth: 240 }}>
          <button
            onClick={() => router.push('/proposals')}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
                     color: 'var(--nv-blue-slate)', fontSize: 14, marginBottom: 8,
                     padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            ← Back to proposals
          </button>
          <h1 style={{ fontSize: 26, fontFamily: 'var(--nv-font-display)', fontWeight: 700,
                       color: 'var(--nv-text-heading)', margin: 0 }}>
            {proposal.hotel_name}
          </h1>
          <p style={{ color: 'var(--nv-text-muted)', fontSize: 14, marginTop: 4 }}>
            {proposal.region?.toUpperCase()} · Created {new Date(proposal.created_at).toLocaleDateString('en-AU')}
          </p>
          <button
            onClick={() => copyToClipboard(proposal.prop_id || proposal.np_id || proposal.id, 'id')}
            title="Click to copy the Proposal ID"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                     marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--nv-text-muted)',
                           background: 'var(--nv-platinum)', borderRadius: 6, padding: '2px 8px' }}>
              {proposal.prop_id || proposal.np_id || proposal.id}
            </span>
            <span style={{ fontSize: 11, color: copied === 'id' ? 'var(--nv-success)' : 'var(--nv-blue-slate)',
                           fontWeight: copied === 'id' ? 700 : 400 }}>
              {copied === 'id' ? '✓ Copied!' : 'Copy'}
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
                    title="Click to copy the Engagement ID (EID)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                             display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--nv-text-muted)',
                                   background: 'var(--nv-platinum)', borderRadius: 6, padding: '2px 8px' }}>
                      EID ({link.service_line}) {link.eid}
                    </span>
                    <span style={{ fontSize: 11,
                                   color: copied === `eid-${link.service_line}` ? 'var(--nv-success)' : 'var(--nv-blue-slate)',
                                   fontWeight: copied === `eid-${link.service_line}` ? 700 : 400 }}>
                      {copied === `eid-${link.service_line}` ? '✓ Copied!' : 'Copy'}
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
            {proposal.status}
          </span>
          {/* NUVCL-126: PDF gated to signed proposals only; Word download removed. */}
          {canDownloadPdf && (
            <button
              className="nv-btn nv-btn--ghost nv-btn--md"
              onClick={handleDownloadPdf}
              disabled={exporting !== null}
            >
              {exporting === 'pdf' ? 'Preparing…' : '⬇ PDF'}
            </button>
          )}
          {/* NUVCL-99: Copy Link promoted from the "Signing Link" card at the
              bottom of the page up into the top action bar (that card is
              removed below) so staff don't have to scroll to grab the link. */}
          {proposal.signing_token && (
            <button
              className="nv-btn nv-btn--ghost nv-btn--md"
              onClick={() => copyToClipboard(publicUrl, 'link')}
            >
              {copied === 'link' ? '✓ Copied!' : '🔗 Copy Link'}
            </button>
          )}
          {/* NUVCL-99: renamed from "View Public Page ↗" to "View ↗" */}
          {proposal.status === 'sent' && (
            <a href={publicUrl} target="_blank" rel="noreferrer"
               className="nv-btn nv-btn--outlined nv-btn--md">
              View ↗
            </a>
          )}
          {canSend && (
            <Link href={`/proposals/new?edit=${proposal.id}`}
                  className="nv-btn nv-btn--outlined nv-btn--md">
              ✎ Edit
            </Link>
          )}
          {canSend && (
            <button
              className="nv-btn nv-btn--outlined nv-btn--md"
              style={{ borderColor: 'var(--nv-error)', color: 'var(--nv-error)' }}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : '🗑 Delete'}
            </button>
          )}
          {proposal.sent_at && (
            <button
              className="nv-btn nv-btn--outlined nv-btn--md"
              onClick={openResendModal}
            >
              ↻ Resend
            </button>
          )}
        </div>
      </div>

      {/* Resend modal */}
      {showResend && (
        <div className="resend-modal-overlay" onMouseDown={() => !resending && setShowResend(false)}>
          <div className="resend-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="resend-modal__header">
              <h3>Resend Proposal</h3>
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
                <p style={{ color: 'var(--nv-success)', fontSize: 13, margin: 0 }}>✓ {resendNotice}</p>
              )}
            </div>
            <div className="resend-modal__footer">
              <button className="nv-btn nv-btn--outlined nv-btn--md"
                      onClick={() => setShowResend(false)} disabled={resending}>
                Cancel
              </button>
              <button className="nv-btn nv-btn--solid nv-btn--md"
                      onClick={handleResend} disabled={resending}>
                {resending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Contact */}
          <div className="nv-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 14, fontFamily: 'var(--nv-font-display)',
                         color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                         letterSpacing: '0.08em', margin: '0 0 16px' }}>
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
            <h2 style={{ fontSize: 14, fontFamily: 'var(--nv-font-display)',
                         color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                         letterSpacing: '0.08em', margin: '0 0 16px' }}>
              Services
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--nv-border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--nv-text-muted)', fontWeight: 600 }}>Service</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--nv-text-muted)', fontWeight: 600 }}>Monthly</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--nv-text-muted)', fontWeight: 600 }}>Setup</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', color: 'var(--nv-text-muted)', fontWeight: 600 }}>Term</th>
                </tr>
              </thead>
              <tbody>
                {(proposal.services || []).map((s: any) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--nv-border-hair)' }}>
                    <td style={{ padding: '10px 0' }}>
                      <span style={{ background: 'var(--nv-platinum)', borderRadius: 6,
                                     padding: '2px 8px', fontSize: 12, fontWeight: 700,
                                     color: 'var(--nv-blue-slate)', marginRight: 8 }}>
                        {s.code}
                      </span>
                      {SERVICE_LABELS[s.code] || s.code}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 0' }}>${s.monthly_fee.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '10px 0' }}>${s.setup_fee.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '10px 0' }}>{s.term_months}m</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--nv-border)' }}>
                  <td colSpan={4} style={{ padding: '12px 0', textAlign: 'right',
                                           fontFamily: 'var(--nv-font-display)', fontWeight: 700,
                                           color: 'var(--nv-blue-slate)', fontSize: 15 }}>
                    Total contract value: ${totalContract.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Sender message */}
          {proposal.sender_message && (
            <div className="nv-card" style={{ padding: 24,
                                              borderLeft: '4px solid var(--nv-tropical-teal)' }}>
              <h2 style={{ fontSize: 14, fontFamily: 'var(--nv-font-display)',
                           color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                           letterSpacing: '0.08em', margin: '0 0 12px' }}>
                Personal Message
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
          <div className="nv-card" style={{ padding: 24,
                                            background: 'var(--nv-surface-dark)' }}>
            <h2 style={{ fontSize: 13, fontFamily: 'var(--nv-font-display)',
                         color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase',
                         letterSpacing: '0.08em', margin: '0 0 16px' }}>
              Proposal Value
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ValueRow label="Monthly Retainer" value={`$${totalMRR.toLocaleString()}`} />
              <ValueRow label="Setup Fees" value={`$${totalSetup.toLocaleString()}`} />
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', paddingTop: 12 }} />
              <ValueRow label="Total Contract"
                value={`$${totalContract.toLocaleString()}`}
                highlight />
            </div>
          </div>

          {/* Timeline */}
          <div className="nv-card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 13, fontFamily: 'var(--nv-font-display)',
                         color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                         letterSpacing: '0.08em', margin: '0 0 16px' }}>
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

          {/* Audit log */}
          {audit.length > 0 && (
            <div className="nv-card" style={{ padding: 24 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--nv-font-display)',
                           color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                           letterSpacing: '0.08em', margin: '0 0 16px' }}>
                Activity Log
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {audit.slice(0, 10).map(e => (
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
          )}
          {/* NUVCL-99: the "Signing Link" card that used to live here was
              removed — Copy Link now lives in the top action bar instead of
              being duplicated in both places. */}
        </div>
      </div>

      {/* Document Preview */}
      <div className="nv-card" style={{ padding: 24, marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 14, fontFamily: 'var(--nv-font-display)',
                       color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                       letterSpacing: '0.08em', margin: 0 }}>
            Document Preview
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
        .resend-modal-overlay {
          position: fixed; inset: 0; background: rgba(15, 23, 32, 0.45);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000; padding: 20px;
        }
        .resend-modal {
          background: white; border-radius: 14px; width: 100%; max-width: 460px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25); max-height: 90vh; overflow-y: auto;
        }
        .resend-modal__header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 20px 24px; border-bottom: 1px solid var(--nv-border);
        }
        .resend-modal__header h3 {
          margin: 0; font-size: 17px; font-family: var(--nv-font-display);
          color: var(--nv-text-heading);
        }
        .resend-modal__close {
          background: none; border: none; cursor: pointer; font-size: 22px;
          line-height: 1; color: var(--nv-text-muted); padding: 0;
        }
        .resend-modal__close:hover { color: var(--nv-text-body); }
        .resend-modal__body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
        .resend-modal__field { display: flex; flex-direction: column; gap: 6px; }
        .resend-modal__label {
          font-size: 12px; font-weight: 600; color: var(--nv-text-muted);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .resend-modal__hint { margin: 0; font-size: 12px; color: var(--nv-text-muted); line-height: 1.5; }
        .resend-modal__footer {
          display: flex; justify-content: flex-end; gap: 10px;
          padding: 16px 24px; border-top: 1px solid var(--nv-border);
        }
      `}</style>
    </div>
  )
}

function Field({ label, value, style }: { label: string; value: string; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 11, color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.1em', marginBottom: 2 }}>
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
      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>{label}</span>
      <span style={{
        fontSize:   highlight ? 18 : 15,
        fontWeight: highlight ? 700 : 600,
        color:      highlight ? 'var(--nv-tropical-teal)' : 'white',
        fontFamily: 'var(--nv-font-display)',
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
