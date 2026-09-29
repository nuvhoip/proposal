'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

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

const FILTERS: { value: string; label: string }[] = [
  { value: '',        label: 'All' },
  { value: 'draft',   label: 'Draft' },
  { value: 'sent',    label: 'Sent' },
  { value: 'signed',  label: 'Signed' },
  { value: 'expired', label: 'Expired' },
]

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
    <div className="nv-page nv-page--wide">
      <header className="nv-page-header">
        <h1 className="nv-page-title">Documents</h1>
        <Link href="/proposals/new" className="nv-btn nv-btn--primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/plus.svg" width="16" height="16" alt="" style={{ filter: 'brightness(0) invert(1)' }} />
          New document
        </Link>
      </header>

      {/* Filters — Figma tab bar (185:18) */}
      <div className="nv-tabs docs-filters" role="tablist" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button
            key={f.value}
            type="button"
            role="tab"
            aria-selected={filter === f.value}
            className={`nv-tab ${filter === f.value ? 'nv-tab--active' : ''}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
          <div className="nv-spinner" />
        </div>
      ) : sortedProposals.length === 0 ? (
        <div className="nv-card nv-empty">
          <span className="nv-iconbox nv-iconbox--32">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/file-contract.svg" alt="" />
          </span>
          <h3 className="nv-h3">No documents found</h3>
          <p style={{ fontSize: 13, marginBottom: 8 }}>Nothing matches this filter yet.</p>
          <Link href="/proposals/new" className="nv-btn nv-btn--primary">
            Create your first document
          </Link>
        </div>
      ) : (
        <div className="nv-card nv-table-card">
          <table className="nv-table docs-table">
            <thead>
              <tr>
                {COLUMNS.map(col => (
                  <th key={col.label || 'actions'}
                      onClick={() => handleSort(col.key)}
                      aria-sort={col.key && sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={col.key ? 'docs-table__sortable' : undefined}>
                    {col.label}
                    {col.key && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sortKey === col.key ? (sortDir === 'asc' ? '/icons/sort-up.svg' : '/icons/sort-down.svg') : '/icons/sort.svg'}
                        alt="" width={12} height={12}
                        className={`docs-table__sort ${sortKey === col.key ? 'docs-table__sort--on' : ''}`}
                      />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedProposals.map((p: any) => (
                <tr key={p.id}
                    className="docs-table__row"
                    onClick={() => router.push(`/proposals/${p.id}`)}
                >
                  <td className="docs-table__id" title={p.id}>
                    {p.prop_id || p.np_id || p.id?.slice(-8)}
                  </td>
                  <td className="docs-table__hotel">
                    {p.hotel_name}
                  </td>
                  <td>
                    <div>{p.contact_name}</div>
                    <div className="docs-table__muted">{p.contact_email}</div>
                  </td>
                  <td>
                    <div className="docs-table__tags">
                      {p.service_codes?.split(',').filter(Boolean).map((c: string) => (
                        <span key={c} className="docs-table__tag">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="nv-num">—</td>
                  <td className="docs-table__muted">
                    {p.sent_at
                      ? new Date(p.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                      : '—'}
                  </td>
                  <td>
                    <span className={`nv-badge ${STATUS_CLASSES[p.status] || ''}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}
                      onClick={e => e.stopPropagation()}>
                    <Link href={`/proposals/${p.id}`}
                          className="nv-btn nv-btn--ghost nv-btn--sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .docs-filters { margin-bottom: 24px; }
        .docs-table__sortable { cursor: pointer; user-select: none; }
        .docs-table :global(.docs-table__sort) { display: inline-block; margin-left: 6px; vertical-align: -1px; opacity: 0.35; }
        .docs-table :global(.docs-table__sort--on) { opacity: 1; }
        .docs-table__row { cursor: pointer; }
        .docs-table__id { font-family: var(--nv-font-mono); font-size: 12px; color: var(--nv-text-muted); }
        .docs-table__hotel { font-weight: 600; color: var(--nv-text-heading); }
        .docs-table__muted { font-size: 12px; color: var(--nv-text-muted); }
        .docs-table__tags { display: flex; gap: 4px; flex-wrap: wrap; }
        .docs-table__tag {
          background: var(--nv-wash-08); color: var(--nv-blue-slate);
          border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 500;
        }
      `}</style>
    </div>
  )
}
