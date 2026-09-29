'use client'

import { useEffect, useState } from 'react'
import type { ServiceCategory } from '@/lib/types'

// Service Lines — the main service-line categories (Sales, Marketing, Revenue
// Management, Central Reservations, Systems, Advisory, and any staff-added
// custom category) offered on Step 2 (Services) of the proposal wizard.
// Fully staff-editable: rename, reorder, deactivate, delete, or add new ones.
// `code` is a stable identifier (also stored on proposal_services.code) set
// once at creation and not editable afterwards — deleting or renaming a
// category later does not affect proposals that already used its code; see
// worker/src/routes/settings.ts.
export default function ServiceLinesPage() {
  const [categories, setCategories] = useState<ServiceCategory[] | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [rowError, setRowError]     = useState<Record<string, string>>({})

  const [newLabel, setNewLabel]     = useState('')
  const [newCode, setNewCode]       = useState('')
  const [newDesc, setNewDesc]       = useState('')
  const [adding, setAdding]         = useState(false)
  const [addError, setAddError]     = useState('')

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load service lines')
      setCategories((data.data as ServiceCategory[]).sort((a, b) => a.sortOrder - b.sortOrder))
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load service lines')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function updateLocal(code: string, patch: Partial<ServiceCategory>) {
    setCategories(prev => prev ? prev.map(c => c.code === code ? { ...c, ...patch } : c) : prev)
  }

  async function saveRow(code: string, patch: { label?: string; description?: string; active?: boolean }) {
    setSavingCode(code)
    setRowError(e => ({ ...e, [code]: '' }))
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories/${code}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
    } catch (e: any) {
      setRowError(err => ({ ...err, [code]: e.message || 'Failed to save' }))
    } finally {
      setSavingCode(null)
    }
  }

  async function toggleActive(cat: ServiceCategory) {
    const active = !cat.active
    updateLocal(cat.code, { active })
    await saveRow(cat.code, { active })
  }

  async function deleteCategory(cat: ServiceCategory) {
    if (!window.confirm(
      `Delete "${cat.label}" (${cat.code})? Proposals that already used this service line keep it, but it will no longer be offered on new proposals.`
    )) return
    setSavingCode(cat.code)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories/${cat.code}`, {
        method: 'DELETE', credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setCategories(prev => prev ? prev.filter(c => c.code !== cat.code) : prev)
    } catch (e: any) {
      setRowError(err => ({ ...err, [cat.code]: e.message || 'Failed to delete' }))
    } finally {
      setSavingCode(null)
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!categories) return
    const target = index + dir
    if (target < 0 || target >= categories.length) return
    const reordered = [...categories]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    const withOrder = reordered.map((c, i) => ({ ...c, sortOrder: i + 1 }))
    setCategories(withOrder)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ codes: withOrder.map(c => c.code) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reorder')
    } catch (e: any) {
      setLoadError(e.message || 'Failed to save new order')
    }
  }

  async function handleAdd() {
    const label = newLabel.trim()
    if (!label) { setAddError('Label is required.'); return }
    setAdding(true)
    setAddError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label, code: newCode.trim() || undefined, description: newDesc.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add service line')
      setCategories(prev => [...(prev || []), data.data as ServiceCategory])
      setNewLabel(''); setNewCode(''); setNewDesc('')
    } catch (e: any) {
      setAddError(e.message || 'Failed to add service line')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="nv-card sl-card">
      <h2 className="sync-card__title">Service lines</h2>
      <p className="sync-card__desc">
        Configure the main service-line categories offered on Step 2 (Services) when creating a new
        proposal. Rename, reorder, deactivate, or delete a category — deactivated categories stop
        appearing as options on new proposals but existing proposals are unaffected.
      </p>

      {loading && <p className="sync-card__desc">Loading service lines…</p>}
      {loadError && <div className="sync-card__result sync-card__result--error">{loadError}</div>}

      {categories && (
        <div className="sl-list">
          {categories.length === 0 && <p className="sl-empty">No service lines configured yet.</p>}
          {categories.map((cat, i) => (
            <div key={cat.code} className={`sl-row ${cat.active ? '' : 'sl-row--inactive'}`}>
              <div className="sl-row__order">
                <button type="button" className="sl-order-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/angle-up.svg" width={12} height={12} alt="" className="nv-icon-inline" /></button>
                <button type="button" className="sl-order-btn" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Move down">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/angle-down.svg" width={12} height={12} alt="" className="nv-icon-inline" /></button>
              </div>

              <span className="sl-row__code" title="Stable code — used internally, not editable">{cat.code}</span>

              <div className="sl-row__fields">
                <input
                  className="nv-input sl-label-input"
                  value={cat.label}
                  onChange={e => updateLocal(cat.code, { label: e.target.value })}
                  onBlur={e => saveRow(cat.code, { label: e.target.value })}
                  placeholder="Label"
                />
                <input
                  className="nv-input sl-desc-input"
                  value={cat.description}
                  onChange={e => updateLocal(cat.code, { description: e.target.value })}
                  onBlur={e => saveRow(cat.code, { description: e.target.value })}
                  placeholder="Short description shown on the Services step (optional)"
                />
              </div>

              <label className="sl-active-toggle">
                <input type="checkbox" checked={cat.active} onChange={() => toggleActive(cat)} />
                <span>Active</span>
              </label>

              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm sl-delete"
                onClick={() => deleteCategory(cat)} disabled={savingCode === cat.code}>
                Delete
              </button>

              {rowError[cat.code] && <div className="sl-row__error">{rowError[cat.code]}</div>}
            </div>
          ))}
        </div>
      )}

      <h3 className="sl-add-title">Add service line</h3>
      <div className="sl-add-form">
        <input className="nv-input" value={newLabel} onChange={e => setNewLabel(e.target.value)}
          placeholder="Label — e.g. Consulting" />
        <input className="nv-input" value={newCode} onChange={e => setNewCode(e.target.value)}
          placeholder="Code (optional — auto-generated from label)" />
        <input className="nv-input" value={newDesc} onChange={e => setNewDesc(e.target.value)}
          placeholder="Short description (optional)" />
        <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" onClick={handleAdd} disabled={adding}>
          {!adding && <img src="/icons/plus.svg" width={14} height={14} alt="" className="nv-icon-inline" />}{adding ? 'Adding…' : 'Add service line'}
        </button>
      </div>
      {addError && <div className="sync-card__result sync-card__result--error">{addError}</div>}

      <style jsx>{`
        .sl-card {
          max-width: 760px;
          width: 100%;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sl-list { display: flex; flex-direction: column; gap: 10px; margin: 16px 0 8px; }
        .sl-empty { font-size: 13px; color: var(--nv-text-muted); font-style: italic; }
        .sl-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border: 1px solid var(--nv-border-hair);
          border-radius: 6px;
          background: rgba(40,104,127,0.03);
          position: relative;
        }
        .sl-row--inactive { opacity: 0.55; }
        .sl-row__order { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
        .sl-order-btn {
          width: 22px; height: 18px; border: 1px solid var(--nv-border); background: none;
          border-radius: 4px; font-size: 9px; cursor: pointer; line-height: 1;
        }
        .sl-order-btn:disabled { opacity: 0.3; cursor: default; }
        .sl-row__code {
          flex-shrink: 0;
          background: var(--nv-blue-slate);
          color: white;
          border-radius: 6px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
          align-self: center;
        }
        .sl-row__fields { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .sl-label-input { font-weight: 600; }
        .sl-desc-input { font-size: 12.5px; }
        .sl-active-toggle {
          display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nv-text-muted);
          flex-shrink: 0; align-self: center; white-space: nowrap;
        }
        .sl-delete { align-self: center; color: var(--nv-error); flex-shrink: 0; }
        .sl-row__error {
          position: absolute; bottom: -18px; left: 12px; font-size: 11px; color: var(--nv-error);
        }
        .sl-add-title {
          font-family: var(--nv-font-body); font-size: 14px; font-weight: 600;
          color: var(--nv-text-heading); margin: 12px 0 4px;
        }
        .sl-add-form {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr auto;
          gap: 8px;
          align-items: center;
        }
        @media (max-width: 900px) { .sl-add-form { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
