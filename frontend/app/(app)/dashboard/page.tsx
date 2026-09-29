'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { DashboardStats } from '@/lib/types'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

const EMPTY_STATS: DashboardStats = {
  totalProposals:      0,
  sentThisMonth:       0,
  signedThisMonth:     0,
  conversionRate:      0,
  totalMonthlyRevenue: 0,
  pendingFollowups:    0,
  avgResponseDays:     0,
  pendingSignature:    0,
  totalRevenuePending: 0,
}

export default function DashboardPage() {
  const router = useRouter()
  const [stats,     setStats]     = useState<DashboardStats>(EMPTY_STATS)
  const [proposals, setProposals] = useState<any[]>([])
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(`${WORKER}/dashboard/stats`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${WORKER}/proposals?limit=5`, { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([statsJson, proposalsJson]) => {
        if (statsJson.data) setStats((s) => ({ ...s, ...statsJson.data }))
        setProposals(proposalsJson.data?.proposals || [])
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="nv-page nv-page--wide">
      <header className="nv-page-header">
        <div>
          <h1 className="nv-page-title">Dashboard</h1>
          <p className="nv-page-subtitle">Good morning — here&apos;s where things stand.</p>
        </div>
        <Link href="/proposals/new" className="nv-btn nv-btn--primary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/rocket.svg" width="16" height="16" alt=""
            style={{ filter: 'brightness(0) invert(1)' }} />
          New document
        </Link>
      </header>

      {/* Stats grid */}
      <section className="stats-grid">
        <StatCard
          label="Total proposals"
          value={stats.totalProposals}
          iconSrc="/icons/file-contract.svg"
        />
        <StatCard
          label="Sent this month"
          value={stats.sentThisMonth}
          iconSrc="/icons/envelopes.svg"
        />
        <StatCard
          label="Signed this month"
          value={stats.signedThisMonth}
          iconSrc="/icons/pen-to-square.svg"
        />
        <StatCard
          label="Conversion rate"
          value={`${stats.conversionRate}%`}
          iconSrc="/icons/chart-line-up.svg"
        />
        <StatCard
          label="Avg. response"
          value={`${stats.avgResponseDays}d`}
          iconSrc="/icons/gauge-simple.svg"
        />
        <StatCard
          label="Awaiting signature"
          value={stats.pendingSignature}
          iconSrc="/icons/circle-pause.svg"
          highlight
        />
      </section>

      {/* Revenue pending banner */}
      <div className="revenue-banner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/filter-circle-dollar.svg" width="24" height="24" alt=""
          className="revenue-banner__icon" />
        <div className="revenue-banner__label">Pipeline value pending signature</div>
        <div className="revenue-banner__value">
          ${stats.totalRevenuePending.toLocaleString('en-AU')}
        </div>
      </div>

      {/* Recent proposals */}
      <section className="proposals-section">
        <div className="proposals-section__header">
          <h2 className="nv-section-title">Recent proposals</h2>
          <Link href="/proposals" className="nv-btn nv-btn--ghost nv-btn--sm">
            View all
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/arrow-right.svg" width="14" height="14" alt="" />
          </Link>
        </div>

        <div className="nv-card nv-table-card">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <div className="nv-spinner" />
            </div>
          ) : proposals.length === 0 ? (
            <div className="nv-empty">
              <span className="nv-iconbox nv-iconbox--32">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/file-contract.svg" alt="" />
              </span>
              <h3 className="nv-h3">No proposals yet</h3>
              <p style={{ fontSize: 13 }}>Proposals you create will show up here.</p>
            </div>
          ) : (
          <table className="nv-table proposals-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Hotel</th>
                <th>Contact</th>
                <th>Services</th>
                <th>Value</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p: any) => (
                <tr key={p.id}
                    className="proposals-table__row"
                    onClick={() => router.push(`/proposals/${p.id}`)}
                >
                  <td className="proposals-table__id" title={p.id}>
                    {p.np_id || p.id?.slice(-8)}
                  </td>
                  <td className="proposals-table__hotel">
                    <span>{p.hotel_name}</span>
                  </td>
                  <td className="proposals-table__contact">{p.contact_name}</td>
                  <td>
                    <div className="service-tags">
                      {(p.service_codes || '').split(',').filter(Boolean).map((c: string) => (
                        <span key={c} className="service-tag">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="proposals-table__value">—</td>
                  <td>
                    <span className={`nv-badge nv-badge--${p.status}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td className="proposals-table__date">
                    {formatDate(p.created_at)}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <Link href={`/proposals/${p.id}`} className="nv-btn nv-btn--ghost nv-btn--sm">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>
      </section>

      <style jsx>{`
        /* Stats — 6 tiles, 12px gaps (Figma 4+ column grid) */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 12px;
        }

        /* Revenue banner — the dark stat-tile variant (browser-app-shell §7):
           #28687F fill, #80B9BF value, radius 14, no shadow. */
        .revenue-banner {
          background: var(--nv-surface-dark);
          border-radius: var(--nv-radius-md);
          padding: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
          gap: 16px;
        }
        .revenue-banner :global(.revenue-banner__icon) {
          filter: brightness(0) invert(1);
          flex-shrink: 0;
        }
        .revenue-banner__label {
          font-size: 13px;
          color: rgba(255,255,255,0.78);
          flex: 1;
        }
        .revenue-banner__value {
          font-family: var(--nv-font-display);
          font-size: 28px;
          font-weight: 700;
          color: var(--nv-tropical-teal);
        }

        /* Proposals section (32px rhythm inside a dense dashboard) */
        .proposals-section__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
        }

        /* Table = global .nv-table (Figma 184:60); only cell content styles here */
        .proposals-table__row { cursor: pointer; }
        .proposals-table__id {
          font-family: var(--nv-font-mono);
          font-size: 12px;
          color: var(--nv-text-muted);
        }
        .proposals-table__hotel span {
          font-weight: 500;
          color: var(--nv-text-heading);
        }
        .proposals-table__contact { color: var(--nv-text-muted); }
        .proposals-table__value { font-weight: 600; color: var(--nv-text-heading); }
        .proposals-table__date  { color: var(--nv-text-muted); }

        .service-tags { display: flex; gap: 4px; flex-wrap: wrap; }
        .service-tag {
          background: var(--nv-wash-08);
          color: var(--nv-blue-slate);
          border-radius: 6px;
          padding: 2px 8px;
          font-size: 12px;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  draft:        'Draft',
  generated:    'Generated',
  sent:         'Sent',
  signed:       'Signed',
  fully_signed: 'Fully signed',
  expired:      'Expired',
  pending:      'Pending',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function StatCard({ label, value, iconSrc, highlight }: {
  label: string; value: string | number; iconSrc: string; highlight?: boolean
}) {
  // Figma stat tile (browser-app-shell §7): card r14 · hairline · padding 24 ·
  // no shadow · icon in a 40×40 icon container · value Comfortaa Bold 28 ·
  // label Raleway 13 muted. `highlight` (awaiting signature) borrows the
  // warning status hue for the hairline only.
  return (
    <div className="nv-card stat-card" style={{
      borderColor: highlight ? 'var(--nv-warning)' : undefined,
    }}>
      <span className="nv-iconbox nv-iconbox--20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc} alt="" />
      </span>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      <style jsx>{`
        .stat-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .stat-card__value {
          font-family: var(--nv-font-display);
          font-size: 28px;
          font-weight: 700;
          color: var(--nv-text-heading);
          line-height: 1.05;
          margin-top: 6px;
        }
        .stat-card__label {
          font-size: 13px;
          color: var(--nv-text-muted);
        }
      `}</style>
    </div>
  )
}
