'use client'

import { useEffect, useState } from 'react'
import type { FeeConfiguration, ServiceCategory } from '@/lib/types'
import { FEE_TYPES, feeTypeLabel, normaliseFeeType } from '@/lib/serviceCatalog'

// Settings → Default fees (migration 0021). A library of reusable default fee
// rows, each linked to any number of service lines through the
// service_line_fee_configurations mapping table. When a service line is added
// to a NEW proposal (wizard Step 2), its Pricing rows are pre-filled from its
// mapped, active fees in the order shown under "By service line". Existing
// proposals are never changed — same "settings are a template" rule as Body
// configuration.
const API = process.env.NEXT_PUBLIC_WORKER_URL

type Draft = { name: string; component: string; feeType: string; setupFee: string; fee: string; term: string; serviceCodes: string[] }
const EMPTY: Draft = { name: '', component: '', feeType: 'Monthly Retainer', setupFee: '', fee: '', term: '', serviceCodes: [] }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data.data as T
}

const toNum = (v: string) => (v.trim() === '' ? '' : Number(v))

export default function DefaultFeesPage() {
  const [configs, setConfigs]       = useState<FeeConfiguration[] | null>(null)
  const [mapping, setMapping]       = useState<Record<string, string[]>>({})
  const [lines, setLines]           = useState<ServiceCategory[]>([])
  const [loadError, setLoadError]   = useState('')
  const [rowError, setRowError]     = useState<Record<string, string>>({})
  const [savingId, setSavingId]     = useState<string | null>(null)
  const [draft, setDraft]           = useState<Draft>(EMPTY)
  const [adding, setAdding]         = useState(false)
  const [addError, setAddError]     = useState('')

  async function load() {
    setLoadError('')
    try {
      const [fees, cats] = await Promise.all([
        call<{ configurations: FeeConfiguration[]; mapping: Record<string, string[]> }>('/settings/fee-configurations'),
        call<ServiceCategory[]>('/settings/service-categories'),
      ])
      setConfigs(fees.configurations)
      setMapping(fees.mapping)
      setLines([...cats].sort((a, b) => a.sortOrder - b.sortOrder))
    } catch (e: any) {
      setLoadError(e.message || 'Failed to load default fees')
    }
  }
  useEffect(() => { load() }, [])

  function patchLocal(id: string, patch: Partial<FeeConfiguration>) {
    setConfigs(prev => prev ? prev.map(c => c.id === id ? { ...c, ...patch } : c) : prev)
  }

  async function save(id: string, patch: Record<string, unknown>) {
    setSavingId(id)
    setRowError(e => ({ ...e, [id]: '' }))
    try {
      const updated = await call<FeeConfiguration>(`/settings/fee-configurations/${id}`, { method: 'PUT', body: JSON.stringify(patch) })
      patchLocal(id, updated)
      if ('serviceCodes' in patch) {
        // Mapping order is decided server-side (new links go last) — reload it.
        const fees = await call<{ configurations: FeeConfiguration[]; mapping: Record<string, string[]> }>('/settings/fee-configurations')
        setMapping(fees.mapping)
      }
    } catch (e: any) {
      setRowError(err => ({ ...err, [id]: e.message || 'Failed to save' }))
    } finally {
      setSavingId(null)
    }
  }

  function toggleLine(cfg: FeeConfiguration, code: string) {
    const serviceCodes = cfg.serviceCodes.includes(code) ? cfg.serviceCodes.filter(c => c !== code) : [...cfg.serviceCodes, code]
    patchLocal(cfg.id, { serviceCodes })
    save(cfg.id, { serviceCodes })
  }

  async function remove(cfg: FeeConfiguration) {
    if (!window.confirm(`Delete the default fee "${cfg.name}"? It is removed from every service line it is linked to. Existing proposals keep their fees.`)) return
    setSavingId(cfg.id)
    try {
      await call(`/settings/fee-configurations/${cfg.id}`, { method: 'DELETE' })
      setConfigs(prev => prev ? prev.filter(c => c.id !== cfg.id) : prev)
      setMapping(prev => Object.fromEntries(Object.entries(prev).map(([k, ids]) => [k, ids.filter(i => i !== cfg.id)])))
    } catch (e: any) {
      setRowError(err => ({ ...err, [cfg.id]: e.message || 'Failed to delete' }))
    } finally {
      setSavingId(null)
    }
  }

  async function move(code: string, index: number, dir: -1 | 1) {
    const ids = [...(mapping[code] || [])]
    const target = index + dir
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setMapping(prev => ({ ...prev, [code]: ids }))
    try {
      await call(`/settings/service-categories/${code}/fee-configurations/order`, { method: 'PUT', body: JSON.stringify({ ids }) })
    } catch (e: any) {
      setLoadError(e.message || 'Failed to save the new order')
    }
  }

  async function add() {
    if (!draft.name.trim() && !draft.component.trim()) { setAddError('Enter a name or a component.'); return }
    setAdding(true)
    setAddError('')
    try {
      const created = await call<FeeConfiguration>('/settings/fee-configurations', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim() || draft.component.trim(), component: draft.component.trim(),
          feeType: normaliseFeeType(draft.feeType), setupFee: toNum(draft.setupFee), fee: toNum(draft.fee),
          term: toNum(draft.term), serviceCodes: draft.serviceCodes,
        }),
      })
      setConfigs(prev => [...(prev || []), created].sort((a, b) => a.name.localeCompare(b.name)))
      const fees = await call<{ configurations: FeeConfiguration[]; mapping: Record<string, string[]> }>('/settings/fee-configurations')
      setMapping(fees.mapping)
      setDraft(EMPTY)
    } catch (e: any) {
      setAddError(e.message || 'Failed to add default fee')
    } finally {
      setAdding(false)
    }
  }

  const byId = new Map((configs || []).map(c => [c.id, c]))
  const lineLabel = (code: string) => lines.find(l => l.code === code)?.label || code

  return (
    <div className="nv-card df-card">
      <h2 className="sync-card__title">Default fees</h2>
      <p className="sync-card__desc">
        Reusable fee rows for the Pricing step. Link each one to the service lines it applies to — when a
        service line is added to a new proposal, its Pricing is pre-filled from its linked, active fees in the
        order set under <strong>By service line</strong>. Existing proposals are not changed.
      </p>
      <datalist id="df-fee-types">{FEE_TYPES.map(t => <option key={t.value} value={t.label} />)}</datalist>

      {!configs && !loadError && <p className="sync-card__desc">Loading default fees…</p>}
      {loadError && <div className="sync-card__result sync-card__result--error">{loadError}</div>}

      {configs && (
        <div className="df-list">
          {configs.length === 0 && <p className="df-empty">No default fees yet — add one below.</p>}
          {configs.map(cfg => (
            <div key={cfg.id} className={`df-row ${cfg.active ? '' : 'df-row--inactive'}`}>
              <div className="df-grid">
                <label className="df-field df-field--wide"><span>Name (Settings only)</span>
                  <input className="nv-input" value={cfg.name} onChange={e => patchLocal(cfg.id, { name: e.target.value })} onBlur={e => save(cfg.id, { name: e.target.value })} />
                </label>
                <label className="df-field df-field--wide"><span>Component (shown in the document)</span>
                  <input className="nv-input" value={cfg.component} onChange={e => patchLocal(cfg.id, { component: e.target.value })} onBlur={e => save(cfg.id, { component: e.target.value })} />
                </label>
                <label className="df-field"><span>Fee type</span>
                  <input className="nv-input" list="df-fee-types" value={feeTypeLabel(cfg.feeType)}
                    onChange={e => patchLocal(cfg.id, { feeType: e.target.value })}
                    onBlur={e => { const v = normaliseFeeType(e.target.value); patchLocal(cfg.id, { feeType: v }); save(cfg.id, { feeType: v }) }} />
                </label>
                <label className="df-field"><span>Setup fee</span>
                  <input className="nv-input" type="number" min={0} value={cfg.setupFee} placeholder="—"
                    onChange={e => patchLocal(cfg.id, { setupFee: toNum(e.target.value) })} onBlur={e => save(cfg.id, { setupFee: toNum(e.target.value) })} />
                </label>
                <label className="df-field"><span>Fee</span>
                  <input className="nv-input" type="number" min={0} value={cfg.fee} placeholder="Blank = fill in per proposal"
                    onChange={e => patchLocal(cfg.id, { fee: toNum(e.target.value) })} onBlur={e => save(cfg.id, { fee: toNum(e.target.value) })} />
                </label>
                <label className="df-field"><span>Terms (months)</span>
                  <input className="nv-input" type="number" min={0} value={cfg.term} placeholder="—"
                    onChange={e => patchLocal(cfg.id, { term: toNum(e.target.value) })} onBlur={e => save(cfg.id, { term: toNum(e.target.value) })} />
                </label>
              </div>
              <div className="df-lines" role="group" aria-label={`Service lines for ${cfg.name}`}>
                <span className="df-lines__label">Service lines:</span>
                {lines.map(l => (
                  <label key={l.code} className={`df-chip ${cfg.serviceCodes.includes(l.code) ? 'df-chip--on' : ''}`}>
                    <input type="checkbox" checked={cfg.serviceCodes.includes(l.code)} onChange={() => toggleLine(cfg, l.code)} disabled={savingId === cfg.id} />
                    {l.code}
                  </label>
                ))}
                <span className="df-spacer" />
                <label className="df-active"><input type="checkbox" checked={cfg.active}
                  onChange={() => { patchLocal(cfg.id, { active: !cfg.active }); save(cfg.id, { active: !cfg.active }) }} /> Active</label>
                <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm df-delete" onClick={() => remove(cfg)} disabled={savingId === cfg.id}>Delete</button>
              </div>
              {rowError[cfg.id] && <div className="df-error">{rowError[cfg.id]}</div>}
            </div>
          ))}
        </div>
      )}

      <h3 className="df-subtitle">Add default fee</h3>
      <div className="df-row df-row--new">
        <div className="df-grid">
          <label className="df-field df-field--wide"><span>Name (Settings only)</span>
            <input className="nv-input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. RM Monthly Management" />
          </label>
          <label className="df-field df-field--wide"><span>Component</span>
            <input className="nv-input" value={draft.component} onChange={e => setDraft(d => ({ ...d, component: e.target.value }))} placeholder="e.g. Monthly Management" />
          </label>
          <label className="df-field"><span>Fee type</span>
            <input className="nv-input" list="df-fee-types" value={draft.feeType} onChange={e => setDraft(d => ({ ...d, feeType: e.target.value }))} />
          </label>
          <label className="df-field"><span>Setup fee</span>
            <input className="nv-input" type="number" min={0} value={draft.setupFee} onChange={e => setDraft(d => ({ ...d, setupFee: e.target.value }))} placeholder="—" />
          </label>
          <label className="df-field"><span>Fee</span>
            <input className="nv-input" type="number" min={0} value={draft.fee} onChange={e => setDraft(d => ({ ...d, fee: e.target.value }))} placeholder="—" />
          </label>
          <label className="df-field"><span>Terms (months)</span>
            <input className="nv-input" type="number" min={0} value={draft.term} onChange={e => setDraft(d => ({ ...d, term: e.target.value }))} placeholder="—" />
          </label>
        </div>
        <div className="df-lines">
          <span className="df-lines__label">Service lines:</span>
          {lines.map(l => (
            <label key={l.code} className={`df-chip ${draft.serviceCodes.includes(l.code) ? 'df-chip--on' : ''}`}>
              <input type="checkbox" checked={draft.serviceCodes.includes(l.code)}
                onChange={() => setDraft(d => ({ ...d, serviceCodes: d.serviceCodes.includes(l.code) ? d.serviceCodes.filter(c => c !== l.code) : [...d.serviceCodes, l.code] }))} />
              {l.code}
            </label>
          ))}
          <span className="df-spacer" />
          <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" onClick={add} disabled={adding}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!adding && <img src="/icons/plus.svg" width={14} height={14} alt="" className="nv-icon-inline" />}{adding ? 'Adding…' : 'Add default fee'}
          </button>
        </div>
        {addError && <div className="df-error">{addError}</div>}
      </div>

      <h3 className="df-subtitle">By service line</h3>
      <p className="sync-card__desc">The fees each service line starts with on a new proposal, in order. Inactive fees are skipped.</p>
      <div className="df-map">
        {lines.map(l => {
          const ids = mapping[l.code] || []
          return (
            <div key={l.code} className="df-map__line">
              <div className="df-map__head"><span className="df-code">{l.code}</span>{lineLabel(l.code)}</div>
              {ids.length === 0
                ? <p className="df-empty">No default fees linked — new proposals use the built-in defaults.</p>
                : <ol className="df-map__list">
                    {ids.map((id, i) => {
                      const cfg = byId.get(id)
                      if (!cfg) return null
                      return (
                        <li key={id} className={cfg.active ? '' : 'df-row--inactive'}>
                          <span className="df-order">
                            <button type="button" className="df-order-btn" disabled={i === 0} onClick={() => move(l.code, i, -1)} aria-label="Move up">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/angle-up.svg" width={12} height={12} alt="" /></button>
                            <button type="button" className="df-order-btn" disabled={i === ids.length - 1} onClick={() => move(l.code, i, 1)} aria-label="Move down">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/angle-down.svg" width={12} height={12} alt="" /></button>
                          </span>
                          <span className="df-map__name">{cfg.name}</span>
                          <span className="df-map__meta">{cfg.component || '—'} · {feeTypeLabel(cfg.feeType) || '—'}{cfg.fee !== '' ? ` · ${Number(cfg.fee).toLocaleString()}` : ''}{cfg.term !== '' ? ` · ${cfg.term} mo` : ''}</span>
                        </li>
                      )
                    })}
                  </ol>}
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .df-card { max-width: 960px; width: 100%; padding: 24px; display: flex; flex-direction: column; gap: 6px; }
        .df-list { display: flex; flex-direction: column; gap: 12px; margin: 16px 0 8px; }
        .df-empty { font-size: 13px; color: var(--nv-text-muted); font-style: italic; margin: 4px 0; }
        .df-row { padding: 12px; border: 1px solid var(--nv-border-hair); border-radius: 6px; background: rgba(40,104,127,0.03); display: flex; flex-direction: column; gap: 10px; }
        .df-row--new { background: white; }
        .df-row--inactive { opacity: 0.55; }
        .df-grid { display: grid; grid-template-columns: 1.4fr 1.4fr 1fr 0.8fr 0.8fr 0.8fr; gap: 8px; }
        .df-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--nv-text-muted); min-width: 0; }
        .df-field :global(.nv-input) { padding: 6px 8px; font-size: 12.5px; }
        .df-lines { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .df-lines__label { font-size: 12px; color: var(--nv-text-muted); margin-right: 2px; }
        .df-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border: 1px solid var(--nv-border); border-radius: 999px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
        .df-chip--on { background: var(--nv-blue-slate); border-color: var(--nv-blue-slate); color: white; }
        .df-chip input { margin: 0; }
        .df-spacer { flex: 1; }
        .df-active { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nv-text-muted); }
        .df-delete { color: var(--nv-error); }
        .df-error { font-size: 11.5px; color: var(--nv-error); }
        .df-subtitle { font-family: var(--nv-font-body); font-size: 14px; font-weight: 600; color: var(--nv-text-heading); margin: 16px 0 4px; }
        .df-map { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 6px; }
        .df-map__line { border: 1px solid var(--nv-border-hair); border-radius: 6px; padding: 10px 12px; }
        .df-map__head { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
        .df-code { background: var(--nv-blue-slate); color: white; border-radius: 6px; padding: 2px 7px; font-size: 11px; letter-spacing: 0.04em; }
        .df-map__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .df-map__list li { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; }
        .df-order { grid-row: span 2; display: flex; flex-direction: column; gap: 2px; }
        .df-order-btn { width: 22px; height: 18px; border: 1px solid var(--nv-border); background: none; border-radius: 4px; cursor: pointer; display: grid; place-content: center; padding: 0; }
        .df-order-btn:disabled { opacity: 0.3; cursor: default; }
        .df-map__name { font-size: 12.5px; font-weight: 600; }
        .df-map__meta { font-size: 11.5px; color: var(--nv-text-muted); }
        @media (max-width: 900px) { .df-grid { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  )
}
