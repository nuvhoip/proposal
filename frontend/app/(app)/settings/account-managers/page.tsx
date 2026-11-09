'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from '@/components/auth/AuthGuard'

const WORKER = process.env.NEXT_PUBLIC_WORKER_URL

type Staff = {
  id: string
  name: string
  email: string
  role: string
  is_account_manager?: number
}

/**
 * Settings › Account managers (2026-11-10).
 *
 * Ticks who can be picked as Account Manager in Step 1 (Hotel details) of
 * the proposal wizard: the team leaders. Saved per staff member
 * (PATCH /staff/:id/account-manager, column from migration 0025). Only
 * someone who is already an account manager can change the list.
 */
export default function AccountManagersPage() {
  const session = useSession()
  const [staff, setStaff]     = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filter, setFilter]   = useState('')
  const [saving, setSaving]   = useState<string | null>(null)

  useEffect(() => {
    fetch(`${WORKER}/staff`, { credentials: 'include' })
      .then(r => r.json())
      .then(body => {
        if (body?.error) throw new Error(body.error)
        setStaff((body?.data || []) as Staff[])
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load staff'))
      .finally(() => setLoading(false))
  }, [])

  const columnMissing = !loading && staff.length > 0 && staff.every(s => s.is_account_manager === undefined)
  const managers = staff.filter(s => s.is_account_manager)
  const canEdit = !columnMissing && (managers.length === 0 || managers.some(s => s.id === session?.staffId))

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? staff.filter(s => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q) || (s.role || '').toLowerCase().includes(q))
      : staff
    // Account managers first, then everyone else, each by name.
    return [...list].sort((a, b) => (Number(!!b.is_account_manager) - Number(!!a.is_account_manager)) || a.name.localeCompare(b.name))
  }, [staff, filter])

  async function toggle(member: Staff) {
    const next = !member.is_account_manager
    setSaving(member.id)
    setError('')
    try {
      const res = await fetch(`${WORKER}/staff/${encodeURIComponent(member.id)}/account-manager`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAccountManager: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) throw new Error(body?.error || `Save failed (${res.status})`)
      setStaff(list => list.map(s => s.id === member.id ? { ...s, is_account_manager: next ? 1 : 0 } : s))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ width: '100%' }}>
      <h1 className="nv-page-title" style={{ marginBottom: 8 }}>Account managers</h1>
      <p className="nv-page-subtitle" style={{ margin: '0 0 24px' }}>
        Only the people ticked here can be picked as Account Manager on a proposal&rsquo;s hotel details.
        {managers.length > 0 && <> Currently {managers.length}: {managers.map(m => m.name).join(', ')}.</>}
      </p>

      {loading && <p style={{ color: 'var(--nv-text-muted)' }}>Loading staff…</p>}
      {columnMissing && (
        <p className="am-note">Account managers aren&rsquo;t set up on the database yet (migration 0025). Until then, everyone is listed in the wizard.</p>
      )}
      {!loading && !columnMissing && !canEdit && (
        <p className="am-note">Only an account manager can change this list.</p>
      )}
      {error && <p role="alert" style={{ color: 'var(--nv-error)', marginBottom: 12 }}>{error}</p>}

      {!loading && staff.length > 0 && (
        <>
          <input
            className="nv-input"
            placeholder="Filter by name, email or role…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ width: '100%', marginBottom: 16 }}
          />
          <div className="nv-card am-list">
            {visible.map(member => (
              <label key={member.id} className="am-row">
                <input
                  type="checkbox"
                  checked={!!member.is_account_manager}
                  disabled={!canEdit || saving === member.id}
                  onChange={() => toggle(member)}
                />
                <span className="am-row__name">{member.name}</span>
                <span className="am-row__meta">{member.role ? `${member.role} · ` : ''}{member.email}</span>
              </label>
            ))}
            {!visible.length && <p className="am-row__meta" style={{ padding: 16 }}>No staff match that filter.</p>}
          </div>
        </>
      )}

      <style jsx>{`
        .am-note {
          font-size: 13px; color: var(--nv-text-muted); background: var(--nv-surface-card);
          border: 1px solid var(--nv-border-hair); border-radius: 10px; padding: 10px 12px; margin-bottom: 16px;
        }
        .am-list { padding: 4px 0; }
        .am-row {
          display: flex; align-items: center; gap: 12px; padding: 10px 18px;
          border-bottom: 1px solid var(--nv-border-hair); cursor: pointer; flex-wrap: wrap;
        }
        .am-row:last-child { border-bottom: 0; }
        .am-row input { width: 16px; height: 16px; accent-color: var(--nv-blue-slate); }
        .am-row input:disabled { cursor: not-allowed; }
        .am-row__name { font-weight: 600; color: var(--nv-text-body); }
        .am-row__meta { font-size: 12px; color: var(--nv-text-muted); }
      `}</style>
    </div>
  )
}
