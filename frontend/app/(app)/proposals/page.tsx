'use client'

import { useEffect, useMemo, useState } from 'react'
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

// Table columns — `key` is the field on a proposal row to sort by when its
// header is clicked (matches the raw column names GET /proposals returns —
// see worker/src/routes/proposals.ts listProposals). A null key means the
// column isn't sortable: Value has no real key here since this list doesn't
// fetch a monthly-value total per row (it always renders "—"), and the
// trailing action column has no data of its own.
const COLUMNS: { label: string; key: string | null }[] = [
  { label: 'ID',       key: 'prop_id' },
  { label: 'Hotel',    key: 'hotel_name' },
  { label: 'Contact',  key: 'contact_name' },
  { label: 'Services', key: 'service_codes' },
  { label: 'Value',    key: null },
  { label: 'Sent',     key: 'sent_at' },
  { label: 'Status',   key: 'status' },
  { label: '',         key: null },
]

// Generic ascending comparator — nulls/blanks always sort last regardless of
// direction (handled by the caller flipping the whole result, not this
// function), strings compare case-insensitively via localeCompare, and
// everything else (the sent_at/created_at ISO datetime strings this API
// returns) compares fine as plain strings without needing Date parsing.
function compareValues(a: unknown, b: unknown): number {
  const aEmpty = a === null || a === undefined || a === ''
  const bEmpty = b === null || b === undefined || b === ''
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b)
  return a < (b as any) ? -1 : a > (b as any) ? 1 : 0
}

export default function ProposalsPage() {
  const router = useRouter()
  const [proposals, setProposals] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('')
  const [sortKey,   setSortKey]   = useState<string | null>(null)
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('asc')

  // Extracted so it can run both on mount/filter-change AND whenever the
  // user comes back to this tab — e.g. after signing a proposal on its
  // public /p/{token} page (opened via Copy Link, often in a separate tab)
  // or updating it from the detail page. Without this, the list only ever
  // fetched once on mount, so a status/expiry change made elsewhere never
  // showed up here until a manual hard refresh.
  useEffect(() => {
    function loadProposals() {
      const url = filter
        ? `${WORKER}/proposals?status=${filter}`
        : `${WORKER}/proposals`
      fetch(url, { credentials: 'include' })
        .then(r => r.json())
        .then(j => setProposals(j.data?.proposals || []))
        .finally(() => setLoading(false))
    }

    loadProposals()

    function onVisible() {
      if (document.visibilityState === 'visible') loadProposals()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', loadProposals)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', loadProposals)
    }
  }, [filter])

  // Default (no column clicked yet) keeps the API's own order — newest
  // first (GET /proposals orders by created_at DESC) — otherwise sorts a
  // copy of the list by the clicked column, nulls/blanks always last.
  const sortedProposals = useMemo(() => {
    if (!sortKey) return proposals
    const dir = sortDir === 'asc' ? 1 : -1
    return [...proposals].sort((a, b) => {
      const av = sortKey === 'prop_id' ? (a.prop_id || a.np_id || a.id) : a[sortKey]
      const bv = sortKey === 'prop_id' ? (b.prop_id || b.np_id || b.id) : b[sortKey]
      return compareValues(av, bv) * dir
    })
  }, [proposals, sortKey, sortDir])

  function handleSort(key: string | null) {
    if (!key) return
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  return (
    <div style={{ padding: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontFamily: 'var(--nv-font-display)',
                     fontWeight: 700, color: 'var(--nv-text-heading)', margin: 0 }}>
          Documents
        </h1>
        <Link href="/proposals/new" className="nv-btn nv-btn--solid nv-btn--md">
          + New Document
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
      ) : sortedProposals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 0', color: 'var(--nv-text-muted)' }}>
          <p style={{ fontSize: 16 }}>No documents found</p>
          <Link href="/proposals/new" className="nv-btn nv-btn--solid nv-btn--md"
                style={{ display: 'inline-block', marginTop: 16 }}>
            Create your first document
          </Link>
        </div>
      ) : (
        <div className="nv-card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--nv-platinum)' }}>
                {COLUMNS.map(col => (
                  <th key={col.label || 'actions'}
                      onClick={() => handleSort(col.key)}
                      style={{ padding: '12px 16px', textAlign: 'left',
                               fontSize: 12, fontWeight: 700,
                               color: 'var(--nv-text-muted)',
                               textTransform: 'uppercase', letterSpacing: '0.06em',
                               cursor: col.key ? 'pointer' : 'default',
                               userSelect: 'none', whiteSpace: 'nowrap' }}>
                    {col.label}
                    {col.key && (
                      <span style={{ marginLeft: 4, opacity: sortKey === col.key ? 1 : 0.25 }}>
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '▲'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProposals.map((p: any) => (
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
                    {p.prop_id || p.np_id || p.id?.slice(-8)}
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
