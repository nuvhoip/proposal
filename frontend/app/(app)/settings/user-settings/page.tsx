'use client'

import { useEffect, useState } from 'react'
import { useSession } from '@/components/auth/AuthGuard'
import { SignaturePad } from '@/components/proposal/SignaturePad'

export default function UserSettingsPage() {
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
    <div className="settings-stack">
      <MyProfileCard />

      <MySignatureCard />

      <div className="nv-card sync-card">
        <h2 className="sync-card__title">Microsoft 365 sync</h2>
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
        .settings-stack { display: flex; flex-direction: column; gap: 20px; max-width: 560px; }
        .sync-card {
          width: 100%;
          margin: 0;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
      `}</style>
    </div>
  )
}

/* Each staff member's own role/position (job title), editable here rather
   than only ever being set by the M365 sync or admin/seed data. Scoped to
   the signed-in user via the worker's session (GET/PATCH /staff/me never
   takes a staffId param) — there's no way to view or edit anyone else's
   role from this page. A later M365 sync will not overwrite it — see the
   worker route's comment. */
function MyProfileCard() {
  const [loading, setLoading] = useState(true)
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [role, setRole]       = useState('')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/me`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load your profile')
        if (cancelled) return
        setName(data.data?.name || '')
        setEmail(data.data?.email || '')
        setRole(data.data?.role || '')
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load your profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save your role')
      setRole(data.data?.role ?? role)
      setSaved(true)
    } catch (e: any) {
      setError(e.message || 'Failed to save your role')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nv-card profile-card">
      <h2 className="sync-card__title">My profile</h2>
      <p className="profile-card__desc">
        Your role/position is shown alongside your name wherever staff are listed in the app.
      </p>

      {loading ? (
        <p className="profile-card__loading">Loading…</p>
      ) : (
        <>
          <div className="profile-card__identity">
            <span className="profile-card__name">{name}</span>
            <span className="profile-card__email">{email}</span>
          </div>

          <label className="profile-card__label" htmlFor="my-role">Role / position</label>
          <input
            id="my-role"
            className="nv-input"
            placeholder="e.g. Director of Sales"
            value={role}
            onChange={e => setRole(e.target.value)}
            maxLength={100}
          />

          <button
            className="nv-btn nv-btn--solid nv-btn--md"
            onClick={handleSave}
            disabled={saving || !role.trim()}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save role'}
          </button>

          {saved && <div className="sync-card__result sync-card__result--ok">Role saved.</div>}
          {error && <div className="sync-card__result sync-card__result--error">{error}</div>}
        </>
      )}

      <style jsx>{`
        .profile-card { width: 100%; margin: 0; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
        .profile-card__loading { color: var(--nv-text-muted); font-size: 13px; }
        .profile-card__identity { display: flex; flex-direction: column; gap: 2px; }
        .profile-card__name { font-weight: 700; color: var(--nv-text-heading); font-size: 15px; }
        .profile-card__email { color: var(--nv-text-muted); font-size: 13px; }
        .profile-card__label {
          font-size: 13px; font-weight: 500; color: var(--nv-text-body);
        }
      `}</style>
    </div>
  )
}

/* NUVCL-117: each staff member's own signature, set once here rather than
   re-drawn/re-typed on every proposal. Scoped entirely to the signed-in user
   via the worker's session (GET/PATCH /staff/me/signature never takes a
   staffId param) — there's no way to view or edit anyone else's signature
   from this page. A typed signature always renders as the account's own
   name (see the worker route's comment for why there's no separate name
   field); a drawn signature uses the same SignaturePad the wizard's
   Signature step and the public accept-proposal page already use. */
function MySignatureCard() {
  const session = useSession()
  const [loading, setLoading]   = useState(true)
  const [method, setMethod]     = useState<'type' | 'draw'>('type')
  const [dataUrl, setDataUrl]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/me/signature`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load your signature')
        if (cancelled) return
        if (data.data?.signatureMethod) setMethod(data.data.signatureMethod)
        if (data.data?.signatureDataUrl) setDataUrl(data.data.signatureDataUrl)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load your signature')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/me/signature`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          signatureMethod:  method,
          signatureDataUrl: method === 'draw' ? dataUrl : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save your signature')
      setSaved(true)
    } catch (e: any) {
      setError(e.message || 'Failed to save your signature')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nv-card sig-card">
      <h2 className="sync-card__title">My signature</h2>
      <p className="sig-card__desc">
        Set your signature once here — new proposals you create will pre-fill their
        Signature step with it (you can still change it per proposal if needed).
      </p>

      {loading ? (
        <p className="sig-card__loading">Loading…</p>
      ) : (
        <>
          <div className="nv-tabs signature-method" role="tablist" aria-label="Signature method">
            <button type="button" role="tab" aria-selected={method === 'type'}
              className={`nv-tab ${method === 'type' ? 'nv-tab--active' : ''}`}
              onClick={() => setMethod('type')}>
              Type name
            </button>
            <button type="button" role="tab" aria-selected={method === 'draw'}
              className={`nv-tab ${method === 'draw' ? 'nv-tab--active' : ''}`}
              onClick={() => setMethod('draw')}>
              Draw signature
            </button>
          </div>

          {method === 'type' ? (
            <div className="signature-preview">
              <span className="signature-preview__label">Signature preview</span>
              <div className="signature-preview__script">{session?.name || 'Your name here'}</div>
            </div>
          ) : (
            <div className="signature-preview">
              <span className="signature-preview__label">Draw signature</span>
              <SignaturePad value={dataUrl} onChange={setDataUrl} />
            </div>
          )}

          <button
            className="nv-btn nv-btn--solid nv-btn--md"
            onClick={handleSave}
            disabled={saving || (method === 'draw' && !dataUrl)}
            aria-busy={saving}
          >
            {saving ? 'Saving…' : 'Save signature'}
          </button>

          {saved   && <div className="sync-card__result sync-card__result--ok">Signature saved.</div>}
          {error   && <div className="sync-card__result sync-card__result--error">{error}</div>}
        </>
      )}

      <style jsx>{`
        .sig-card { width: 100%; margin: 0; padding: 24px; display: flex; flex-direction: column; gap: 14px; }
        .sig-card__loading { color: var(--nv-text-muted); font-size: 13px; }

        /* type / draw choice = Figma tab bar (185:18) */
        .signature-method { margin-bottom: 4px; }

        .signature-preview__label {
          display: block; font-size: 13px; font-weight: 500; color: var(--nv-text-body); margin-bottom: 6px;
        }
        .signature-preview__script {
          font-family: var(--font-signature);
          font-size: 40px;
          line-height: 1.3;
          color: var(--nv-text-heading);
          padding: 6px 14px 10px;
          border-bottom: 1px solid var(--nv-border-hair);
          max-width: 420px;
        }
      `}</style>
    </div>
  )
}
