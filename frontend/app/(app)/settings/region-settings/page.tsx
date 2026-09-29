'use client'

import { useEffect, useState } from 'react'
import type { Region, RegionSettings, TermsClause } from '@/lib/types'

const REGION_LABELS: Record<Region, string> = { au: 'Australia', uk: 'United Kingdom', ie: 'Ireland' }
const REGION_ORDER: Region[] = ['au', 'uk', 'ie']
const CURRENCY_OPTIONS = ['AUD', 'GBP', 'EUR']

// Region Settings — Nuvho address / legal footer / currency / default T&Cs
// per operating region, applied onto the proposal wizard's Hotel Details
// step when that region is selected (see lib/types.ts RegionSettings).
export default function RegionSettingsPage() {
  const [regions, setRegions]           = useState<Record<Region, RegionSettings> | null>(null)
  const [regionLoading, setRegionLoading] = useState(true)
  const [regionError, setRegionError]     = useState('')
  const [activeRegion, setActiveRegion]   = useState<Region>('au')
  const [regionSaving, setRegionSaving]   = useState(false)
  const [regionSaveOk, setRegionSaveOk]   = useState<Region | null>(null)
  const [regionSaveError, setRegionSaveError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/regions`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load region settings')
        if (cancelled) return
        const map = {} as Record<Region, RegionSettings>
        for (const r of (data.data as RegionSettings[])) map[r.region] = r
        setRegions(map)
      } catch (e: any) {
        if (!cancelled) setRegionError(e.message || 'Failed to load region settings')
      } finally {
        if (!cancelled) setRegionLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function updateActiveRegion(patch: Partial<RegionSettings>) {
    setRegions(prev => prev ? { ...prev, [activeRegion]: { ...prev[activeRegion], ...patch } } : prev)
  }

  async function handleSaveRegion() {
    if (!regions) return
    const rs = regions[activeRegion]
    setRegionSaving(true)
    setRegionSaveError('')
    setRegionSaveOk(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/regions/${activeRegion}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: rs.address, companyName: rs.companyName, aboutNuvho: rs.aboutNuvho,
          footerText: rs.footerText, currency: rs.currency, clauses: rs.clauses,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save region settings')
      setRegionSaveOk(activeRegion)
    } catch (e: any) {
      setRegionSaveError(e.message || 'Failed to save region settings')
    } finally {
      setRegionSaving(false)
    }
  }

  const activeRegionSettings = regions?.[activeRegion]

  return (
    <div className="nv-card region-card">
      <h2 className="sync-card__title">Region settings</h2>
      <p className="sync-card__desc">
        Configure Nuvho&rsquo;s address, about-us text, legal footer, currency, and default Terms &amp;
        Conditions per operating region. These are applied automatically onto a new proposal&rsquo;s
        Hotel Details step when that region is selected.
      </p>

      <div className="region-tabs" role="tablist" aria-label="Region">
        {REGION_ORDER.map(r => (
          <button key={r} type="button" role="tab" aria-selected={activeRegion === r}
            className={`region-tab ${activeRegion === r ? 'region-tab--active' : ''}`}
            onClick={() => { setActiveRegion(r); setRegionSaveOk(null); setRegionSaveError('') }}>
            {REGION_LABELS[r]}
          </button>
        ))}
      </div>

      {regionLoading && <p className="sync-card__desc">Loading region settings…</p>}
      {regionError && <div className="sync-card__result sync-card__result--error">{regionError}</div>}

      {activeRegionSettings && (
        <>
          <div className="region-form-grid">
            <label className="region-field">
              <span className="region-field__label">Nuvho company name</span>
              <input className="nv-input" type="text"
                value={activeRegionSettings.companyName}
                onChange={e => updateActiveRegion({ companyName: e.target.value })}
                placeholder="e.g. Nuvho Pty Ltd" />
              <span className="region-field__hint">
                The legal entity name for this region — shown as the section heading in the proposal
                document (e.g. &ldquo;Nuvho Pty Ltd&rdquo; for Australia). Each of AU/UK/IE has its own entity.
              </span>
            </label>
            <label className="region-field">
              <span className="region-field__label">Nuvho address</span>
              <textarea className="nv-input region-textarea"
                value={activeRegionSettings.address}
                onChange={e => updateActiveRegion({ address: e.target.value })}
                placeholder="e.g. Level 4, 123 Example Street, Brisbane QLD 4000, Australia" />
            </label>
            <label className="region-field">
              <span className="region-field__label">About</span>
              <textarea className="nv-input region-textarea region-textarea--tall"
                value={activeRegionSettings.aboutNuvho}
                onChange={e => updateActiveRegion({ aboutNuvho: e.target.value })}
                placeholder="e.g. Nuvho Pty Ltd is a new breed of hotel services company…" />
              <span className="region-field__hint">
                The paragraph shown under the company name above — wording can differ per region too.
              </span>
            </label>
            <label className="region-field">
              <span className="region-field__label">Legal footer</span>
              <textarea className="nv-input region-textarea"
                value={activeRegionSettings.footerText}
                onChange={e => updateActiveRegion({ footerText: e.target.value })}
                placeholder="e.g. Nuvho Pty Ltd · ABN 00 000 000 000 · Registered in Queensland" />
            </label>
            <label className="region-field region-field--currency">
              <span className="region-field__label">Currency</span>
              <select className="nv-input" value={activeRegionSettings.currency}
                onChange={e => updateActiveRegion({ currency: e.target.value })}>
                {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <h3 className="region-clauses-title">Default terms &amp; conditions</h3>
          <RegionClausesEditor
            clauses={activeRegionSettings.clauses}
            onChange={clauses => updateActiveRegion({ clauses })}
          />

          <button type="button" className="nv-btn nv-btn--solid nv-btn--md"
            onClick={handleSaveRegion} disabled={regionSaving} aria-busy={regionSaving}>
            {regionSaving ? 'Saving…' : `Save ${REGION_LABELS[activeRegion]} Settings`}
          </button>

          {regionSaveOk === activeRegion && (
            <div className="sync-card__result sync-card__result--ok">Region settings saved.</div>
          )}
          {regionSaveError && (
            <div className="sync-card__result sync-card__result--error">{regionSaveError}</div>
          )}
        </>
      )}

      <style jsx>{`
        .region-card {
          max-width: 720px;
          width: 100%;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .region-tabs { display: flex; gap: 6px; margin: 8px 0 20px; }
        .region-tab {
          padding: 8px 18px; border-radius: 999px; border: 1px solid var(--nv-border-hair);
          background: none; font-size: 13px; font-weight: 600; color: var(--nv-text-muted); cursor: pointer;
        }
        .region-tab--active {
          border-color: var(--nv-blue-slate); color: var(--nv-blue-slate); background: rgba(40,104,127,0.06);
        }
        .region-form-grid { display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px; }
        .region-field { display: flex; flex-direction: column; gap: 6px; }
        .region-field__label { font-size: 13px; font-weight: 600; color: var(--nv-text-body); }
        .region-field__hint { font-size: 11.5px; color: var(--nv-text-muted); line-height: 1.5; }
        .region-textarea { min-height: 70px; resize: vertical; }
        .region-textarea--tall { min-height: 110px; }
        .region-field--currency select { max-width: 160px; }
        .region-clauses-title {
          font-family: var(--nv-font-body); font-size: 14px; font-weight: 600;
          color: var(--nv-text-heading); margin: 4px 0 10px;
        }
      `}</style>
    </div>
  )
}

/* ─── Region default T&Cs clause editor (Settings → Region Settings) ───
 * Deliberately a lighter-weight sibling of the wizard's TermsEditor
 * (app/(app)/proposals/new/page.tsx) — add/edit/remove only, no drag
 * reordering — since these are just the seed clauses copied onto a new
 * proposal's Terms step, not a live proposal's own clause list. */
function RegionClausesEditor({ clauses, onChange }: {
  clauses: TermsClause[]; onChange: (clauses: TermsClause[]) => void
}) {
  function update(id: string, field: keyof TermsClause, val: string | boolean) {
    onChange(clauses.map(c => c.id === id ? { ...c, [field]: val } : c))
  }
  function remove(id: string) {
    onChange(clauses.filter(c => c.id !== id))
  }
  function add() {
    onChange([...clauses, { id: `term_custom_${Date.now()}`, heading: 'New Clause', text: '', enabled: true }])
  }

  return (
    <div className="clause-list">
      {clauses.length === 0 && <p className="clause-empty">No default clauses configured yet.</p>}
      {clauses.map(c => (
        <div key={c.id} className="clause-row">
          <input className="nv-input clause-heading" value={c.heading}
            onChange={e => update(c.id, 'heading', e.target.value)} placeholder="Clause heading" />
          <textarea className="nv-input clause-text" value={c.text}
            onChange={e => update(c.id, 'text', e.target.value)} placeholder="Clause text" />
          <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm clause-remove"
            onClick={() => remove(c.id)}>Remove</button>
        </div>
      ))}
      <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" onClick={add}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/plus.svg" width={14} height={14} alt="" className="nv-icon-inline" /> Add clause</button>

      <style jsx>{`
        .clause-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
        .clause-empty { font-size: 13px; color: var(--nv-text-muted); font-style: italic; margin: 0 0 8px; }
        .clause-row {
          display: flex; flex-direction: column; gap: 6px; padding: 10px 12px;
          border: 1px solid var(--nv-border-hair); border-radius: 6px; background: rgba(40,104,127,0.03);
        }
        .clause-heading { font-size: 12px; font-weight: 600; }
        .clause-text { font-size: 12px; min-height: 56px; resize: vertical; }
        .clause-remove { align-self: flex-end; color: var(--nv-error); }
      `}</style>
    </div>
  )
}
