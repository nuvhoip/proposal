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
    <div className="page-content">
      <header className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Good morning — here&apos;s where things stand.</p>
        </div>
        <Link href="/proposals/new" className="nv-btn nv-btn--solid nv-btn--md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/rocket.svg" width="16" height="16" alt=""
            style={{ marginRight: 6, filter: 'brightness(0) invert(1)', flexShrink: 0 }} />
          New Proposal
        </Link>
      </header>

      {/* Stats grid */}
      <section className="stats-grid">
        <StatCard
          label="Total Proposals"
          value={stats.totalProposals}
          iconSrc="/icons/file-contract.svg"
          color="blue"
        />
        <StatCard
          label="Sent This Month"
          value={stats.sentThisMonth}
          iconSrc="/icons/envelopes.svg"
          color="teal"
        />
        <StatCard
          label="Signed This Month"
          value={stats.signedThisMonth}
          iconSrc="/icons/pen-to-square.svg"
          color="green"
        />
        <StatCard
          label="Conversion Rate"
          value={`${stats.conversionRate}%`}
          iconSrc="/icons/chart-line-up.svg"
          color="purple"
        />
        <StatCard
          label="Avg. Response"
          value={`${stats.avgResponseDays}d`}
          iconSrc="/icons/gauge-simple.svg"
          color="teal"
        />
        <StatCard
          label="Awaiting Signature"
          value={stats.pendingSignature}
          iconSrc="/icons/circle-pause.svg"
          color="warning"
          highlight
        />
      </section>

      {/* Revenue pending banner */}
      <div className="revenue-banner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/filter-circle-dollar.svg" width="28" height="28" alt=""
          className="revenue-banner__icon" />
        <div className="revenue-banner__label">Pipeline value pending signature</div>
        <div className="revenue-banner__value">
          ${stats.totalRevenuePending.toLocaleString('en-AU')}
        </div>
      </div>

      {/* Recent proposals */}
      <section className="proposals-section">
        <div className="proposals-section__header">
          <h2 className="section-title">Recent Proposals</h2>
          <Link href="/proposals" className="nv-btn nv-btn--ghost nv-btn--sm">
            View all →
          </Link>
        </div>

        <div className="nv-card proposals-table-card">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <div className="nv-spinner" />
            </div>
          ) : proposals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--nv-text-muted)' }}>
              No proposals yet
            </div>
          ) : (
          <table className="proposals-table">
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
        .page-content {
          padding: 32px 40px;
          max-width: 1280px;
        }
        @media (max-width: 768px) { .page-content { padding: 20px 16px; } }

        .page-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 32px;
          gap: 16px;
        }
        .page-title {
          font-family: var(--font-comfortaa);
          font-size: 28px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin-bottom: 4px;
        }
        .page-subtitle {
          font-size: 14px;
          color: var(--nv-text-muted);
        }

        /* Stats */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }

        /* Revenue banner */
        .revenue-banner {
          background: var(--nv-surface-dark);
          border-radius: var(--nv-radius-md);
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 32px;
          gap: 16px;
        }
        .revenue-banner :global(.revenue-banner__icon) {
          filter: brightness(0) invert(1);
          opacity: 0.65;
          flex-shrink: 0;
        }
        .revenue-banner__label {
          font-size: 13px;
          color: rgba(255,255,255,0.7);
          font-family: var(--font-raleway);
          flex: 1;
        }
        .revenue-banner__value {
          font-family: var(--font-comfortaa);
          font-size: 26px;
          font-weight: 700;
          color: var(--nv-tropical-teal);
          letter-spacing: -0.5px;
        }

        /* Proposals section */
        .proposals-section { margin-top: 0; }
        .proposals-section__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .section-title {
          font-family: var(--font-comfortaa);
          font-size: 18px;
          font-weight: 700;
          color: var(--nv-text-heading);
        }

        .proposals-table-card { padding: 0; overflow: hidden; }

        .proposals-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .proposals-table thead tr {
          border-bottom: 1px solid var(--nv-border-hair);
          background: var(--nv-surface-page);
        }
        .proposals-table th {
          padding: 10px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 600;
          color: var(--nv-text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .proposals-table td {
          padding: 12px 16px;
          border-bottom: 1px solid var(--nv-border-hair);
          color: var(--nv-text-body);
          vertical-align: middle;
        }
        .proposals-table tbody tr:last-child td { border-bottom: none; }
        .proposals-table__row { cursor: pointer; }
        .proposals-table__row:hover { background: var(--nv-surface-page); }

        .proposals-table__id {
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          color: var(--nv-text-muted);
          letter-spacing: 0.02em;
        }
        .proposals-table__hotel span {
          font-weight: 500;
          color: var(--nv-text-heading);
        }
        .proposals-table__contact { color: var(--nv-text-muted); }
        .proposals-table__value { font-weight: 600; color: var(--nv-text-heading); }
        .proposals-table__date  { color: var(--nv-text-muted); font-size: 12px; }

        .service-tags { display: flex; gap: 4px; flex-wrap: wrap; }
        .service-tag {
          background: rgba(40,104,127,0.08);
          color: var(--nv-blue-slate);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }
      `}</style>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  draft:   'Draft',
  sent:    'Sent',
  signed:  'Signed',
  expired: 'Expired',
  pending: 'Pending',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function StatCard({ label, value, iconSrc, color, highlight }: {
  label: string; value: string | number; iconSrc: string;
  color: 'blue' | 'teal' | 'green' | 'purple' | 'warning'; highlight?: boolean
}) {
  const bgMap = {
    blue:    'rgba(40,104,127,0.07)',
    teal:    'rgba(128,185,191,0.1)',
    green:   'rgba(74,143,110,0.08)',
    purple:  'rgba(103,37,100,0.07)',
    warning: 'rgba(243,198,93,0.1)',
  }
  return (
    <div className="nv-card stat-card" style={{
      borderColor: highlight ? 'var(--nv-warning)' : undefined,
    }}>
      <div className="stat-card__icon" style={{ background: bgMap[color] }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconSrc} width="20" height="20" alt="" />
      </div>
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
      <style jsx>{`
        .stat-card {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .stat-card__icon {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
        }
        .stat-card__value {
          font-family: var(--font-comfortaa);
          font-size: 28px;
          font-weight: 700;
          color: var(--nv-text-heading);
          line-height: 1;
        }
        .stat-card__label {
          font-size: 12px;
          color: var(--nv-text-muted);
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
