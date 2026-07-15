'use client'

import { useState } from 'react'

export default function SettingsPage() {
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ total: number; created: number; updated: number } | null>(null)
  const [syncError, setSyncError] = useState('')

  async function handleSync() {
    setSyncing(true)
    setSyncError('')
    setSyncResult(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/sync-m365`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setSyncResult(data.data)
    } catch (e: any) {
      setSyncError(e.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="page-content">
      <div className="nv-card sync-card">
        <h2 className="sync-card__title">Microsoft 365 Sync</h2>
        <p className="sync-card__desc">
          Pull every active @nuvho.com account from Microsoft 365 into the staff roster,
          so they show up in the proposal wizard&rsquo;s &ldquo;Sending on behalf of&rdquo; list.
          Existing staff members are matched by email and updated (name, M365 IDs) — their
          role, BD-facing flag, and signatory status are left untouched. New accounts are
          added with default settings.
        </p>

        <button
          className="nv-btn nv-btn--solid nv-btn--md"
          onClick={handleSync}
          disabled={syncing}
          aria-busy={syncing}
        >
          {syncing ? 'Syncing…' : 'Sync Microsoft 365 Users'}
        </button>

        {syncResult && (
          <div className="sync-card__result sync-card__result--ok">
            Synced {syncResult.total} users — {syncResult.created} added, {syncResult.updated} updated.
          </div>
        )}
        {syncError && (
          <div className="sync-card__result sync-card__result--error">{syncError}</div>
        )}
      </div>

      <style jsx>{`
        .page-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          min-height: 100vh;
          padding: 40px 24px;
        }

        .sync-card {
          max-width: 560px;
          margin: 0;
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .sync-card__title {
          font-family: var(--font-comfortaa);
          font-size: 18px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin: 0;
        }
        .sync-card__desc {
          font-size: 13px;
          line-height: 1.6;
          color: var(--nv-text-muted);
          margin: 0;
        }
        .sync-card__result {
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
        }
        .sync-card__result--ok {
          background: rgba(40,104,127,0.06);
          color: var(--nv-blue-slate);
        }
        .sync-card__result--error {
          background: rgba(152,38,73,0.07);
          color: var(--nv-error);
        }
      `}</style>
    </div>
  )
}
