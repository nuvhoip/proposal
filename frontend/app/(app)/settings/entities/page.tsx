'use client'

import { useEffect, useState } from 'react'
import type { TermsClause } from '@/lib/types'

const CURRENCY_OPTIONS = ['AUD', 'GBP', 'EUR']

// One entity as returned by GET /settings/entities. entityCode/legalName/
// jurisdiction/role/isDataController/isActive come live from the Nuvho
// Master Registry (register.nuvho.com's /v1/ref/entities, proxied via the
// worker so REGISTRY_API_KEY never reaches the browser) — this app never
// stores or edits those. address/aboutNuvho/footerText/currency/clauses are
// this app's own data (the registry has no concept of them), stored in the
// worker's entity_settings table and editable below (see
// worker/src/routes/settings.ts getEntitySettings()/updateEntitySettings()).
interface EntitySettings {
  entityCode:       string
  legalName:        string
  jurisdiction:     string
  role:             string
  isDataController: boolean
  isActive:         boolean
  address:          string
  aboutNuvho:       string
  footerText:       string
  currency:         string
  clauses:          TermsClause[]
}

// Entities — every legal entity Nuvho operates through (not just the 3
// client-facing "operating" entities per region — holding, IP-holding, and
// processor entities are included too), sourced live from the Nuvho Master
// Registry. Each entity has its own address, about-us text, legal footer,
// currency, and default Terms & Conditions — this app's own data, entirely
// separate from the registry. Replaces the old Region Settings page (the
// Australia/United Kingdom/Ireland tabs) — the proposal wizard's Hotel
// Details step still applies the matching operating entity's settings when
// a region is selected (see worker/src/routes/settings.ts getRegionSettings,
// which now computes that feed from entity_settings instead of a separate
// region-keyed table, so wizard behaviour is unchanged).
export default function EntitiesPage() {
  const [entities, setEntities]     = useState<EntitySettings[] | null>(null)
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState('')
  const [activeCode, setActiveCode] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [saveOk, setSaveOk]         = useState<string | null>(null)
  const [saveError, setSaveError]   = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/entities`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load entities from the Master Registry')
        if (cancelled) return
        const list = (data.data ?? []) as EntitySettings[]
        setEntities(list)
        if (list.length > 0) setActiveCode(list[0].entityCode)
      } catch (e: any) {
        if (!cancelled) setLoadError(e.message || 'Failed to load entities from the Master Registry')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function updateActive(patch: Partial<EntitySettings>) {
    setEntities(prev => prev ? prev.map(e => e.entityCode === activeCode ? { ...e, ...patch } : e) : prev)
  }

  async function handleSave() {
    if (!entities || !activeCode) return
    const entity = entities.find(e => e.entityCode === activeCode)
    if (!entity) return
    setSaving(true)
    setSaveError('')
    setSaveOk(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/entities/${encodeURIComponent(activeCode)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          address: entity.address, aboutNuvho: entity.aboutNuvho,
          footerText: entity.footerText, currency: entity.currency, clauses: entity.clauses,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save entity settings')
      setSaveOk(activeCode)
    } catch (e: any) {
      setSaveError(e.message || 'Failed to save entity settings')
    } finally {
      setSaving(false)
    }
  }

  const active = entities?.find(e => e.entityCode === activeCode)

  return (
    <div className="nv-card entities-card">
      <h2 className="sync-card__title">Entities</h2>
      <p className="sync-card__desc">
        Every legal entity Nuvho operates through, sourced live from the Nuvho Master Registry —
        each with its own address, about-us text, legal footer, currency, and default Terms &amp;
        Conditions, applied automatically onto a new proposal&rsquo;s Hotel Details step for the
        entity that hotel group is contracted under.
      </p>

      {loadError && (
        <div className="sync-card__result sync-card__result--error">
          Couldn&rsquo;t load entities from the Master Registry ({loadError}).
        </div>
      )}
      {loading && <p className="sync-card__desc">Loading entities…</p>}

      {entities && entities.length > 0 && (
        <div className="region-tabs" role="tablist" aria-label="Entity">
          {entities.map(e => (
            <button key={e.entityCode} type="button" role="tab" aria-selected={activeCode === e.entityCode}
              className={`region-tab ${activeCode === e.entityCode ? 'region-tab--active' : ''}`}
              onClick={() => { setActiveCode(e.entityCode); setSaveOk(null); setSaveError('') }}>
              {e.legalName}
            </button>
          ))}
        </div>
      )}

      {entities && entities.length === 0 && !loading && !loadError && (
        <p className="sync-card__desc">No entities found in the Master Registry.</p>
      )}

      {active && (
        <>
          <div className="entity-meta">
            <span className="entity-meta__item"><strong>Legal name:</strong> {active.legalName}</span>
            <span className="entity-meta__item"><strong>Entity code:</strong> {active.entityCode}</span>
            <span className="entity-meta__item"><strong>Jurisdiction:</strong> {active.jurisdiction}</span>
            <span className="entity-meta__item"><strong>Role:</strong> {active.role.replace(/_/g, ' ')}</span>
            <span className="entity-meta__item"><strong>Data controller:</strong> {active.isDataController ? 'Yes' : 'No'}</span>
            <span className={`entities-status ${active.isActive ? 'entities-status--active' : 'entities-status--inactive'}`}>
              {active.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>

          <div className="region-form-grid">
            <label className="region-field">
              <span className="region-field__label">Nuvho address</span>
              <textarea className="nv-input region-textarea"
                value={active.address}
                onChange={e => updateActive({ address: e.target.value })}
                placeholder="e.g. Level 4, 123 Example Street, Brisbane QLD 4000, Australia" />
            </label>
            <label className="region-field">
              <span className="region-field__label">About</span>
              <textarea className="nv-input region-textarea region-textarea--tall"
                value={active.aboutNuvho}
                onChange={e => updateActive({ aboutNuvho: e.target.value })}
                placeholder="e.g. Nuvho Pty Ltd is a new breed of hotel services company…" />
              <span className="region-field__hint">
                The paragraph shown under the entity name — wording can differ per entity.
              </span>
            </label>
            <label className="region-field">
              <span className="region-field__label">Legal footer</span>
              <textarea className="nv-input region-textarea"
                value={active.footerText}
                onChange={e => updateActive({ footerText: e.target.value })}
                placeholder="e.g. Nuvho Pty Ltd · ABN 00 000 000 000 · Registered in Queensland" />
            </label>
            <label className="region-field region-field--currency">
              <span className="region-field__label">Currency</span>
              <select className="nv-input" value={active.currency}
                onChange={e => updateActive({ currency: e.target.value })}>
                {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <h3 className="region-clauses-title">Default terms &amp; conditions</h3>
          <RegionClausesEditor
            clauses={active.clauses}
            onChange={clauses => updateActive({ clauses })}
          />

          <button type="button" className="nv-btn nv-btn--solid nv-btn--md"
            onClick={handleSave} disabled={saving} aria-busy={saving}>
            {saving ? 'Saving…' : `Save ${active.legalName} Settings`}
          </button>

          {saveOk === activeCode && (
            <div className="sync-card__result sync-card__result--ok">Entity settings saved.</div>
          )}
          {saveError && (
            <div className="sync-card__result sync-card__result--error">{saveError}</div>
          )}
        </>
      )}

      <style jsx>{`
        .entities-card {
          max-width: 900px;
          width: 100%;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .region-tabs { display: flex; gap: 6px; margin: 8px 0 12px; flex-wrap: wrap; }
        .region-tab {
          padding: 8px 18px; border-radius: 999px; border: 1px solid var(--nv-border-hair);
          background: none; font-size: 13px; font-weight: 600; color: var(--nv-text-muted); cursor: pointer;
        }
        .region-tab--active {
          border-color: var(--nv-blue-slate); color: var(--nv-blue-slate); background: rgba(40,104,127,0.06);
        }
        .entity-meta {
          display: flex; flex-wrap: wrap; gap: 6px 18px; padding: 10px 14px; margin-bottom: 8px;
          border: 1px solid var(--nv-border-hair); border-radius: 6px; background: rgba(40,104,127,0.03);
          font-size: 12px; color: var(--nv-text-body);
        }
        .entity-meta__item strong { font-weight: 700; color: var(--nv-text-heading); margin-right: 4px; }
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
        /* Figma badge anatomy: h26 pill, Raleway Medium 12 — active = semantic good, inactive = mono neutral */
        .entities-status {
          display: inline-flex; align-items: center; height: 26px; padding: 0 12px; border-radius: 999px;
          font-size: 12px; font-weight: 500;
        }
        .entities-status--active { color: #FFFFFF; background: var(--nv-success); }
        .entities-status--inactive { color: var(--nv-text-body); background: var(--nv-wash-08); }
      `}</style>
    </div>
  )
}

/* ─── Entity default T&Cs clause editor (Settings → Entities) ───
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
