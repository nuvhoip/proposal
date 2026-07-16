'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import type { DashboardStats, ProposalSummary } from '@/lib/types'

// ── Mock data (replaced by Worker API fetch) ──────────────────────────────
const MOCK_STATS: DashboardStats = {
  totalProposals:      42,
  sentThisMonth:        8,
  signedThisMonth:      5,
  conversionRate:      62.5,
  totalMonthlyRevenue: 210000,
  pendingFollowups:     4,
  avgResponseDays:      3.2,
  pendingSignature:     3,
  totalRevenuePending:  148500,
}

const MOCK_PROPOSALS: ProposalSummary[] = [
  { id: 'p1', hotelName: 'The Langham Sydney',   clientName: 'Sarah Mitchell',  clientEmail: 'sarah@langham.com',    status: 'sent',    regionId: 'au', totalMonthlyValue: 18500, servicesCount: 2, createdAt: '2026-06-25', expiryDate: '2026-07-25', viewCount: 3 },
  { id: 'p2', hotelName: 'Park Hyatt Melbourne', clientName: "James O'Brien",   clientEmail: 'james@parkhyatt.com',  status: 'signed',  regionId: 'au', totalMonthlyValue: 32000, servicesCount: 3, createdAt: '2026-06-20', expiryDate: '2026-07-20', viewCount: 7 },
  { id: 'p3', hotelName: 'QT Gold Coast',        clientName: 'Emma Thornton',   clientEmail: 'emma@qthotels.com',    status: 'draft',   regionId: 'au', totalMonthlyValue: 14200, servicesCount: 1, createdAt: '2026-06-28', expiryDate: '2026-07-28', viewCount: 0 },
  { id: 'p4', hotelName: 'Ovolo Woolloomooloo',  clientName: 'Michael Chan',    clientEmail: 'michael@ovolo.com',    status: 'sent',    regionId: 'au', totalMonthlyValue: 9800,  servicesCount: 1, createdAt: '2026-06-22', expiryDate: '2026-07-22', viewCount: 2 },
  { id: 'p5', hotelName: 'The Darling',          clientName: 'Priya Sharma',    clientEmail: 'priya@thedarling.com', status: 'expired', regionId: 'au', totalMonthlyValue: 21000, servicesCount: 2, createdAt: '2026-05-28', expiryDate: '2026-06-28', viewCount: 5 },
]

export default function DashboardPage() {
  const [stats]     = useState<DashboardStats>(MOCK_STATS)
  const [proposals] = useState<ProposalSummary[]>(MOCK_PROPOSALS)

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
          <table className="proposals-table">
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Contact</th>
                <th>Services</th>
                <th>Value</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proposals.map(p => (
                <tr key={p.id}>
                  <td className="proposals-table__hotel">
                    <span>{p.hotelName}</span>
                  </td>
                  <td className="proposals-table__contact">{p.clientName}</td>
                  <td>
                    <div className="service-tags">
                      <span className="service-tag">{p.servicesCount} service{p.servicesCount !== 1 ? 's' : ''}</span>
                    </div>
                  </td>
                  <td className="proposals-table__value">
                    ${p.totalMonthlyValue.toLocaleString('en-AU')}
                  </td>
                  <td>
                    <span className={`nv-badge nv-badge--${p.status}`}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </td>
                  <td className="proposals-table__date">
                    {formatDate(p.createdAt)}
                  </td>
                  <td>
                    <Link href={`/proposals/${p.id}`} className="nv-btn nv-btn--ghost nv-btn--sm">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        .proposals-table tbody tr:hover { background: var(--nv-surface-page); }

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
