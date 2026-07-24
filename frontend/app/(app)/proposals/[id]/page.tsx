'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Proposal } from '@/lib/types'
import { buildDocModelFromProposal, downloadBlob } from '@/lib/documentModel'
import { ProposalDocument } from '@/components/proposal/ProposalDocument'
import { buildDocxFile } from '@/lib/exportDocx'

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
  const [sending,  setSending]  = useState(false)
  const [copied,   setCopied]   = useState<'id' | 'link' | null>(null)
  const [showDoc,  setShowDoc]  = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'word' | null>(null)

  async function copyToClipboard(text: string, which: 'id' | 'link') {
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

  useEffect(() => {
    if (!id) return
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
  }, [id])

  async function handleSend() {
    if (!confirm(`Send proposal to ${proposal?.contact_email}?`)) return
    setSending(true)
    try {
      const res = await fetch(`${WORKER}/proposals/${id}/send`, {
        method: 'POST', credentials: 'include',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProposal((p: any) => ({ ...p, status: 'sent' }))
    } catch (e: any) {
      alert('Failed to send: ' + e.message)
    } finally {
      setSending(false)
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
  const docModel  = buildDocModelFromProposal(proposal)

  const handleDownloadPdf = () => {
    setShowDoc(true)
    setExporting('pdf')
    // Print-to-PDF: @media print (globals.css) hides everything except
    // #proposal-print-root, which <ProposalDocument> renders into.
    window.setTimeout(() => window.print(), 50)
    window.setTimeout(() => setExporting(null), 600)
  }

  const handleDownloadWord = async () => {
    setExporting('word')
    try {
      const blob = await buildDocxFile(docModel)
      downloadBlob(blob, `${docModel.title.replace(/[^\w-]+/g, '-')}.docx`)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div style={{ padding: '32px', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
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
            onClick={() => copyToClipboard(proposal.np_id || proposal.id, 'id')}
            title="Click to copy the Proposal ID"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                     marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--nv-text-muted)',
                           background: 'var(--nv-platinum)', borderRadius: 6, padding: '2px 8px' }}>
              {proposal.np_id || proposal.id}
            </span>
            <span style={{ fontSize: 11, color: copied === 'id' ? 'var(--nv-success)' : 'var(--nv-blue-slate)',
                           fontWeight: copied === 'id' ? 700 : 400 }}>
              {copied === 'id' ? '✓ Copied!' : 'Copy'}
            </span>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className={`nv-badge ${STATUS_CLASSES[proposal.status] || ''}`}>
            {proposal.status}
          </span>
          <button
            className="nv-btn nv-btn--ghost nv-btn--md"
            onClick={handleDownloadPdf}
            disabled={exporting !== null}
          >
            {exporting === 'pdf' ? 'Preparing…' : '⬇ PDF'}
          </button>
          <button
            className="nv-btn nv-btn--ghost nv-btn--md"
            onClick={handleDownloadWord}
            disabled={exporting !== null}
          >
            {exporting === 'word' ? 'Preparing…' : '⬇ Word'}
          </button>
          {canSend && (
            <Link href={`/proposals/new?edit=${proposal.id}`}
                  className="nv-btn nv-btn--outlined nv-btn--md">
              ✎ Edit
            </Link>
          )}
          {canSend && (
            <button
              className="nv-btn nv-btn--solid nv-btn--md"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? 'Sending…' : '✉ Send Proposal'}
            </button>
          )}
          {proposal.status === 'sent' && (
            <a href={publicUrl} target="_blank" rel="noreferrer"
               className="nv-btn nv-btn--outlined nv-btn--md">
              View Public Page ↗
            </a>
          )}
        </div>
      </div>

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
              <p style={{ color: 'var(--nv-text-body)', lineHeight: 1.6, margin: 0,
                          fontStyle: 'italic', fontSize: 15 }}>
                &ldquo;{proposal.sender_message}&rdquo;
              </p>
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

          {/* Public link */}
          {proposal.signing_token && (
            <div className="nv-card" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 13, fontFamily: 'var(--nv-font-display)',
                           color: 'var(--nv-text-muted)', textTransform: 'uppercase',
                           letterSpacing: '0.08em', margin: '0 0 10px' }}>
                Signing Link
              </h2>
              <div style={{ background: 'var(--nv-platinum)', borderRadius: 8,
                            padding: '8px 12px', wordBreak: 'break-all',
                            fontSize: 12, color: 'var(--nv-text-muted)' }}>
                {publicUrl}
              </div>
              <button
                className="nv-btn nv-btn--ghost nv-btn--sm"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => copyToClipboard(publicUrl, 'link')}
              >
                {copied === 'link' ? '✓ Copied!' : 'Copy link'}
              </button>
            </div>
          )}
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
