'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

const STATUS_CLASSES: Record<string, string> = {
  draft:   'nv-badge--draft',
  sent:    'nv-badge--sent',
  signed:  'nv-badge--signed',
  expired: 'nv-badge--expired',
  pending: 'nv-badge--pending',
}

export default function ProposalsPage() {
  const router = useRouter()
  const [proposals, setProposals] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('')

  useEffect(() => {
    const url = filter
      ? `${WORKER}/proposals?status=${filter}`
      : `${WORKER}/proposals`
    fetch(url, { credentials: 'include' })
      .then(r => r.json())
      .then(j => setProposals(j.data?.proposals || []))
      .finally(() => setLoading(false))
  }, [filter])

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontFamily: 'var(--nv-font-display)',
                     fontWeight: 700, color: 'var(--nv-text-heading)', margin: 0 }}>
          Proposals
        </h1>
        <Link href="/proposals/new" className="nv-btn nv-btn--solid nv-btn--md">
          + New Proposal
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['', 'draft', 'sent', 'signed', 'expired'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 16px', borderRadius: 999, border: '1px solid',
              borderColor: filter === s ? 'var(--nv-blue-slate)' : 'var(--nv-border)',
              background:  filter === s ? 'var(--nv-blue-slate)' : 'transparent',
              color:       filter === s ? 'white' : 'var(--nv-text-body)',
              cursor: 'pointer', fontSize: 13, fontFamily: 'var(--nv-font-display)',
              fontWeight: 600, transition: 'all 220ms',
            }}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <div className="nv-spinner" />
        </div>
      ) : proposals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--nv-text-muted)' }}>
          <p style={{ fontSize: 16 }}>No proposals found</p>
          <Link href="/proposals/new" className="nv-btn nv-btn--solid nv-btn--md"
                style={{ display: 'inline-block', marginTop: 16 }}>
            Create your first proposal
          </Link>
        </div>
      ) : (
        <div className="nv-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--nv-platinum)' }}>
                {['ID', 'Hotel', 'Contact', 'Services', 'Value', 'Sent', 'Status', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left',
                                       fontSize: 12, fontWeight: 700,
                                       color: 'var(--nv-text-muted)',
                                       textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {proposals.map((p: any) => (
                <tr key={p.id}
                    style={{ borderBottom: '1px solid var(--nv-border-hair)',
                             transition: 'background 150ms', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--nv-platinum)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => router.push(`/proposals/${p.id}`)}
                >
                  <td style={{ padding: '14px 16px', fontFamily: 'monospace', fontSize: 11,
                               color: 'var(--nv-text-muted)' }}
                      title={p.id}>
                    {p.np_id || p.id?.slice(-8)}
                  </td>
                  <td style={{ padding: '14px 16px', fontWeight: 600,
                               color: 'var(--nv-text-heading)' }}>
                    {p.hotel_name}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--nv-text-body)' }}>
                    <div>{p.contact_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--nv-text-muted)' }}>
                      {p.contact_email}
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {p.service_codes?.split(',').map((c: string) => (
                      <span key={c} style={{
                        display: 'inline-block', background: 'var(--nv-platinum)',
                        borderRadius: 6, padding: '2px 7px', fontSize: 11,
                        fontWeight: 700, color: 'var(--nv-blue-slate)',
                        marginRight: 4,
                      }}>{c}</span>
                    ))}
                  </td>
                  <td style={{ padding: '14px 16px', fontFamily: 'var(--nv-font-display)',
                               fontWeight: 600, color: 'var(--nv-text-heading)' }}>
                    —
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--nv-text-muted)' }}>
                    {p.sent_at
                      ? new Date(p.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                      : '—'}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span className={`nv-badge ${STATUS_CLASSES[p.status] || ''}`}>
                      {p.status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}>
                    <Link href={`/proposals/${p.id}`}
                          className="nv-btn nv-btn--ghost nv-btn--sm">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
