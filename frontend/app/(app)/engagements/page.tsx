'use client'

import Link from 'next/link'

export default function EngagementsPage() {
  return (
    <div className="page-content">
      <div className="coming-soon">
        <div className="coming-soon__icon-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/handshake.svg"
            width="52"
            height="52"
            alt=""
            className="coming-soon__icon"
          />
        </div>

        <h1 className="coming-soon__heading">Engagements</h1>

        <div className="coming-soon__badge">Coming Soon</div>

        <p className="coming-soon__body">
          Track every client relationship from first contact through to contract renewal.
          Engagement timelines, touchpoint logs, and health scores — all in one place.
        </p>

        <Link href="/dashboard" className="nv-btn nv-btn--outlined nv-btn--md">
          ← Back to Dashboard
        </Link>
      </div>

      <style jsx>{`
        .page-content {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 40px 24px;
        }

        .coming-soon {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          max-width: 440px;
          gap: 20px;
        }

        .coming-soon__icon-wrap {
          width: 96px;
          height: 96px;
          border-radius: 24px;
          background: rgba(40, 104, 127, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(40, 104, 127, 0.12);
        }

        .coming-soon__icon {
          opacity: 0.7;
        }

        .coming-soon__heading {
          font-family: var(--font-comfortaa);
          font-size: 32px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin: 0;
          line-height: 1.1;
        }

        .coming-soon__badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 16px;
          border-radius: 999px;
          background: rgba(128, 185, 191, 0.15);
          border: 1px solid rgba(128, 185, 191, 0.3);
          color: var(--nv-blue-slate);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }

        .coming-soon__body {
          font-family: var(--font-raleway), system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.65;
          color: var(--nv-text-muted);
          margin: 0;
        }
      `}</style>
    </div>
  )
}
