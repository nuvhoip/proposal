'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProposalDraft, ServiceCode, Region } from '@/lib/types'

const STEPS = [
  { id: 1, label: 'Hotel Details'  },
  { id: 2, label: 'Services'       },
  { id: 3, label: 'Sender'         },
  { id: 4, label: 'Cover Image'    },
  { id: 5, label: 'Preview & Send' },
]

const EMPTY_DRAFT: ProposalDraft = {
  step: 1,
  hotel: {
    name: '', region: 'au', hgid: '', entityCode: '', contactName: '', contactEmail: '',
    contactPhone: '', contactTitle: '', propertyAddress: '',
    hubspotDealId: '',
  },
  services:     [],
  sender:       { staffId: '', message: '' },
  cover:        { coverUrl: '' },
  preview:      { recipientEmail: '' },
}

export default function NewProposalPage() {
  const router = useRouter()
  const [draft, setDraft]       = useState<ProposalDraft>(EMPTY_DRAFT)
  const [saving, setSaving]     = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [staff, setStaff]       = useState<M365Staff[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError]     = useState('')

  const step = draft.step

  React.useEffect(() => {
    let cancelled = false
    async function loadStaff() {
      setStaffLoading(true)
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load Microsoft 365 users')
        if (!cancelled) setStaff(data.data || [])
      } catch (e: any) {
        if (!cancelled) setStaffError(e.message || 'Failed to load Microsoft 365 users')
      } finally {
        if (!cancelled) setStaffLoading(false)
      }
    }
    loadStaff()
    return () => { cancelled = true }
  }, [])

  function goNext() {
    const errs = validateStep(draft)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setDraft(d => ({ ...d, step: Math.min(5, d.step + 1) }))
  }
  function goBack() {
    setErrors({})
    setDraft(d => ({ ...d, step: Math.max(1, d.step - 1) }))
  }

  async function createDraftProposal(): Promise<string> {
    const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(draft),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to create proposal')
    return data.data.id as string
  }

  async function handleSaveDraft() {
    setSavingDraft(true)
    try {
      const id = await createDraftProposal()
      router.push(`/proposals/${id}`)
    } catch (err: any) {
      setErrors({ submit: err.message })
    } finally {
      setSavingDraft(false)
    }
  }

  async function handleSubmit() {
    setSaving(true)
    try {
      const id = await createDraftProposal()
      const sendRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const sendData = await sendRes.json()
      if (!sendRes.ok) throw new Error(sendData.error || 'Proposal created but failed to send')
      router.push(`/proposals/${id}`)
    } catch (err: any) {
      setErrors({ submit: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="wizard-page">
      {/* Step indicator */}
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            <button
              className={`nv-step ${step === s.id ? 'nv-step--active' : ''} ${step > s.id ? 'nv-step--done' : ''}`}
              onClick={() => step > s.id && setDraft(d => ({ ...d, step: s.id }))}
              disabled={step < s.id}
            >
              <span className="nv-step__number">
                {step > s.id
                  ? <svg width="10" height="10" viewBox="0 0 448 512" fill="white">
                      {/* nuvho-brand icon: check (duotone-thin) */}
                      <path d="M444.7 65.5c3.6 2.6 4.3 7.6 1.7 11.2l-288 392c-1.4 1.9-3.5 3.1-5.8 3.2s-4.6-.7-6.3-2.3l-144-144c-3.1-3.1-3.1-8.2 0-11.3s8.2-3.1 11.3 0L151.1 451.8 433.6 67.3c2.6-3.6 7.6-4.3 11.2-1.7z"/>
                    </svg>
                  : s.id}
              </span>
              <span className="nv-step__label">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <div className="wizard-steps__divider" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="wizard-body">
        <div className="nv-card wizard-card animate-fade-in-up">
          {step === 1 && (
            <Step1HotelDetails draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 2 && (
            <Step2Services draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 3 && (
            <Step3Sender
              draft={draft} setDraft={setDraft} errors={errors}
              staff={staff} staffLoading={staffLoading} staffError={staffError}
            />
          )}
          {step === 4 && (
            <Step4Cover draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 5 && (
            <Step5Preview draft={draft} setDraft={setDraft} errors={errors} />
          )}

          {errors.submit && (
            <div className="wizard-error">{errors.submit}</div>
          )}

          {/* Navigation */}
          <div className="wizard-nav">
            {step > 1
              ? <button className="nv-btn nv-btn--outlined nv-btn--md" onClick={goBack}>
                  ← Back
                </button>
              : <div />}
            {step < 5
              ? <button className="nv-btn nv-btn--solid nv-btn--md" onClick={goNext}>
                  Continue →
                </button>
              : <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    className="nv-btn nv-btn--outlined nv-btn--md"
                    onClick={handleSaveDraft}
                    disabled={saving || savingDraft}
                    aria-busy={savingDraft}
                  >
                    {savingDraft ? 'Saving…' : 'Save as Draft'}
                  </button>
                  <button
                    className="nv-btn nv-btn--solid nv-btn--md"
                    onClick={handleSubmit}
                    disabled={saving || savingDraft}
                    aria-busy={saving}
                  >
                    {saving ? 'Generating…' : 'Generate & Send Proposal'}
                  </button>
                </div>}
          </div>
        </div>
      </div>

      <style jsx>{`
        .wizard-page { padding: 32px 40px; max-width: 900px; }
        @media (max-width: 768px) { .wizard-page { padding: 16px; } }

        .wizard-steps {
          display: flex;
          align-items: center;
          gap: 0;
          margin-bottom: 32px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .wizard-steps__divider {
          flex: 1;
          height: 1px;
          background: var(--nv-border);
          min-width: 24px;
          max-width: 60px;
        }

        .wizard-body { }

        .wizard-card { padding: 36px; }

        .wizard-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid var(--nv-border-hair);
        }

        .wizard-error {
          background: rgba(152,38,73,0.07);
          border: 1px solid rgba(152,38,73,0.2);
          border-radius: 10px;
          color: var(--nv-error);
          padding: 12px 16px;
          font-size: 13px;
          margin-top: 16px;
        }
      `}</style>
    </div>
  )
}

/* ─── Step 1: Hotel Details ─── */
interface RegistryHotelGroupSummary {
  hgid: string
  group_name: string
  trading_name: string | null
  geo: string
  status: string
}

interface RegistryEntity {
  entity_code: string
  legal_name: string
  jurisdiction: string
  is_data_controller: boolean
  is_active: boolean
}

// Matches the Region type (lib/types.ts) and the wizard's own Region select.
const REGION_OPTIONS: { value: Region; label: string }[] = [
  { value: 'au', label: 'Australia (AU)' },
  { value: 'uk', label: 'United Kingdom (UK)' },
  { value: 'ie', label: 'Ireland (IE)' },
]

// registry.entity_codes.jurisdiction is a free-text string ("Australia (QLD)",
// "United Kingdom", "Ireland") — not a 2-letter geo code — so entities are
// matched to a Region by country-name prefix rather than an exact code match.
const REGION_JURISDICTION_PREFIX: Record<Region, string> = {
  au: 'australia',
  uk: 'united kingdom',
  ie: 'ireland',
}

function Step1HotelDetails({ draft, setDraft, errors }: StepProps) {
  const h = draft.hotel
  function update(key: string, val: string) {
    setDraft(d => ({ ...d, hotel: { ...d.hotel, [key]: val } }))
  }

  const [hgQuery, setHgQuery]     = useState(h.hgid ? h.name : '')
  const [hgResults, setHgResults] = useState<RegistryHotelGroupSummary[]>([])
  const [hgLoading, setHgLoading] = useState(false)
  const [hgOpen, setHgOpen]       = useState(false)
  const [hgResolveError, setHgResolveError] = useState('')

  // Add Hotel Group — used when a search turns up no existing match in the
  // registry. Saves a new record to the Nuvho master registry (register.nuvho.com)
  // via the worker proxy, then resolves it into the draft just like a normal pick.
  const [hgAddOpen, setHgAddOpen]           = useState(false)
  const [hgAddSaving, setHgAddSaving]       = useState(false)
  const [hgAddError, setHgAddError]         = useState('')
  const [hgAddEntityCode, setHgAddEntityCode]   = useState('')
  const [hgAddGroupName, setHgAddGroupName]     = useState('')
  const [hgAddTradingName, setHgAddTradingName] = useState('')
  const [hgAddGeo, setHgAddGeo]         = useState<Region>('au')
  const [hgAddStatus, setHgAddStatus]   = useState<'prospect' | 'onboarding'>('prospect')
  const [hgEntities, setHgEntities] = useState<RegistryEntity[]>([])

  React.useEffect(() => {
    if (!hgAddOpen) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/entities`,
          { credentials: 'include' }
        )
        const data = await res.json()
        if (!res.ok || data.success === false) {
          throw new Error(data.error?.message || 'Could not load legal entities from the registry.')
        }
        if (!cancelled) setHgEntities(data.data?.entities || [])
      } catch (e) {
        if (!cancelled) {
          setHgEntities([])
          setHgAddError(e instanceof Error ? e.message : 'Could not load legal entities from the registry.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [hgAddOpen])

  // Active data-controller entities for the selected geo — the registry
  // requires entity_code to be an active data controller. jurisdiction is
  // free text ("Australia (QLD)") so match by country-name prefix, not
  // an exact geo-code comparison.
  const hgAddGeoEntities = hgEntities.filter(e => {
    if (!e.is_data_controller || !e.is_active) return false
    const prefix = REGION_JURISDICTION_PREFIX[hgAddGeo]
    return e.jurisdiction.trim().toLowerCase().startsWith(prefix)
  })

  // Default the entity picker to the group's only data controller for a geo
  // (matches the common case — most geos have exactly one).
  React.useEffect(() => {
    if (!hgAddOpen) return
    if (hgAddGeoEntities.length === 1) setHgAddEntityCode(hgAddGeoEntities[0].entity_code)
    else setHgAddEntityCode('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hgAddOpen, hgAddGeo, hgEntities])

  function openAddHotelGroup() {
    setHgAddGroupName(hgQuery.trim())
    setHgAddTradingName('')
    setHgAddGeo(h.region)
    setHgAddStatus('prospect')
    setHgAddError('')
    setHgAddOpen(true)
    setHgOpen(false)
  }

  async function submitAddHotelGroup() {
    if (!hgAddGroupName.trim()) { setHgAddError('Group name is required.'); return }
    if (!hgAddEntityCode) { setHgAddError('Select the legal entity for this hotel group.'); return }
    setHgAddSaving(true)
    setHgAddError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_name: hgAddGroupName.trim(),
          trading_name: hgAddTradingName.trim() || undefined,
          entity_code: hgAddEntityCode,
          geo: hgAddGeo.toUpperCase(),
          status: hgAddStatus,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.success === false) {
        throw new Error(data.error?.message || 'Could not save this hotel group to the master registry.')
      }
      const hg = data.data?.hotelGroup
      setDraft(d => ({
        ...d,
        hotel: {
          ...d.hotel,
          hgid: hg.hgid,
          entityCode: hg.entity_code,
          region: hgAddGeo,
          name: d.hotel.name || hg.trading_name || hg.group_name,
        },
      }))
      setHgQuery(hg.trading_name || hg.group_name)
      setHgAddOpen(false)
    } catch (e) {
      setHgAddError(e instanceof Error ? e.message : 'Could not save this hotel group.')
    } finally {
      setHgAddSaving(false)
    }
  }

  React.useEffect(() => {
    if (h.hgid || hgQuery.trim().length < 2) { setHgResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setHgLoading(true)
      try {
        const params = new URLSearchParams({ q: hgQuery.trim(), geo: h.region.toUpperCase() })
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/typeahead?${params}`,
          { credentials: 'include' }
        )
        const data = await res.json()
        if (!cancelled) setHgResults(data.data?.results || [])
      } catch {
        if (!cancelled) setHgResults([])
      } finally {
        if (!cancelled) setHgLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [hgQuery, h.region, h.hgid])

  async function selectHotelGroup(hg: RegistryHotelGroupSummary) {
    setHgOpen(false)
    setHgQuery(hg.trading_name || hg.group_name)
    setHgResolveError('')
    // Typeahead doesn't return entity_code — resolve the full record so the
    // registry proposal sync (POST /v1/proposals) has what it requires.
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${hg.hgid}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      const entityCode = data.data?.hotelGroup?.entity_code
      if (!entityCode) throw new Error('No entity_code on this hotel group')
      setDraft(d => ({
        ...d,
        hotel: {
          ...d.hotel,
          hgid: hg.hgid,
          entityCode,
          name: d.hotel.name || hg.trading_name || hg.group_name,
        },
      }))
    } catch {
      setHgResolveError('Could not resolve entity code for this hotel group — try again.')
    }
  }

  function clearHotelGroup() {
    setDraft(d => ({ ...d, hotel: { ...d.hotel, hgid: '', entityCode: '' } }))
    setHgQuery('')
    setHgResolveError('')
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Hotel Details</h2>
      <p className="step-desc">Enter the hotel and primary contact information.</p>

      <div className="form-grid">
        <FormField label="Hotel Group *" error={errors.hgid || hgResolveError} span={2}>
          {h.hgid ? (
            <div className="hg-selected">
              <span>{h.name || hgQuery} <code>{h.hgid}</code></span>
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={clearHotelGroup}>
                Change
              </button>
            </div>
          ) : (
            <div className="hg-search">
              <input className="nv-input" placeholder="Search registered hotel groups…"
                value={hgQuery}
                onChange={e => { setHgQuery(e.target.value); setHgOpen(true) }}
                onFocus={() => setHgOpen(true)}
                onBlur={() => setTimeout(() => setHgOpen(false), 150)} />
              {hgOpen && hgQuery.trim().length >= 2 && (
                <div className="hg-dropdown">
                  {hgLoading && <div className="hg-dropdown__item hg-dropdown__item--muted">Searching…</div>}
                  {!hgLoading && hgResults.length === 0 && (
                    <div className="hg-dropdown__item hg-dropdown__item--muted">
                      No matching hotel group in the registry.
                    </div>
                  )}
                  {hgResults.map(hg => (
                    <button type="button" key={hg.hgid} className="hg-dropdown__item"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectHotelGroup(hg)}>
                      <strong>{hg.trading_name || hg.group_name}</strong>
                      <span className="hg-dropdown__meta">{hg.hgid} · {hg.geo} · {hg.status}</span>
                    </button>
                  ))}
                  <button type="button" className="hg-dropdown__item hg-dropdown__item--add"
                    onMouseDown={e => e.preventDefault()}
                    onClick={openAddHotelGroup}>
                    + Add "{hgQuery.trim()}" as a new hotel group
                  </button>
                </div>
              )}
            </div>
          )}
        </FormField>

        <FormField label="Hotel name *" error={errors.hotelName}>
          <input className="nv-input" placeholder="e.g. The Langham Sydney"
            value={h.name} onChange={e => update('name', e.target.value)} />
        </FormField>

        <FormField label="Region *" error={errors.region}>
          <select className="nv-input" value={h.region}
            onChange={e => update('region', e.target.value as Region)}>
            <option value="au">Australia</option>
            <option value="uk">United Kingdom</option>
            <option value="ie">Ireland</option>
          </select>
        </FormField>

        <FormField label="Contact name *" error={errors.contactName}>
          <input className="nv-input" placeholder="e.g. Sarah Mitchell"
            value={h.contactName} onChange={e => update('contactName', e.target.value)} />
        </FormField>

        <FormField label="Contact title" error={errors.contactTitle}>
          <input className="nv-input" placeholder="e.g. Director of Sales"
            value={h.contactTitle} onChange={e => update('contactTitle', e.target.value)} />
        </FormField>

        <FormField label="Contact email *" error={errors.contactEmail}>
          <input className="nv-input" type="email" placeholder="name@hotel.com"
            value={h.contactEmail} onChange={e => update('contactEmail', e.target.value)} />
        </FormField>

        <FormField label="Contact phone" error={errors.contactPhone}>
          <input className="nv-input" type="tel" placeholder="+61 2 9876 5432"
            value={h.contactPhone} onChange={e => update('contactPhone', e.target.value)} />
        </FormField>

        <FormField label="Property address" error={errors.propertyAddress} span={2}>
          <input className="nv-input" placeholder="1 Kent St, Sydney NSW 2000"
            value={h.propertyAddress} onChange={e => update('propertyAddress', e.target.value)} />
        </FormField>

        <FormField label="HubSpot Deal ID" error={errors.hubspotDealId}>
          <input className="nv-input" placeholder="(optional)"
            value={h.hubspotDealId} onChange={e => update('hubspotDealId', e.target.value)} />
        </FormField>
      </div>

      {hgAddOpen && (
        <div className="hg-modal-overlay" onMouseDown={() => setHgAddOpen(false)}>
          <div className="hg-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="hg-modal__header">
              <h3>New Hotel Group</h3>
              <button type="button" className="hg-modal__close" aria-label="Close"
                onClick={() => setHgAddOpen(false)}>
                ×
              </button>
            </div>

            <div className="hg-modal__body">
              <div className="hg-modal__field">
                <label className="hg-modal__label">Entity Code</label>
                <select className="nv-input" value={hgAddEntityCode}
                  onChange={e => setHgAddEntityCode(e.target.value)}>
                  <option value="">Select…</option>
                  {hgAddGeoEntities.map(en => (
                    <option key={en.entity_code} value={en.entity_code}>
                      {en.legal_name} ({en.entity_code})
                    </option>
                  ))}
                </select>
                <p className="hg-modal__hint">
                  The Nuvho legal entity responsible for this group's contracts and billing.
                </p>
              </div>

              <div className="hg-modal__field">
                <label className="hg-modal__label">Group Name *</label>
                <input className="nv-input" placeholder="e.g. Aria Hotels & Resorts"
                  value={hgAddGroupName} onChange={e => setHgAddGroupName(e.target.value)} />
              </div>

              <div className="hg-modal__field">
                <label className="hg-modal__label">Trading Name</label>
                <input className="nv-input" placeholder="e.g. Aria Hotels"
                  value={hgAddTradingName} onChange={e => setHgAddTradingName(e.target.value)} />
                <p className="hg-modal__hint">
                  The name used in day-to-day operations. Leave blank if the same as the group name.
                </p>
              </div>

              <div className="hg-modal__field">
                <label className="hg-modal__label">Geo</label>
                <select className="nv-input" value={hgAddGeo}
                  onChange={e => setHgAddGeo(e.target.value as Region)}>
                  {REGION_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <p className="hg-modal__hint">
                  The primary geographic region. This cannot be changed after the group is created.
                </p>
              </div>

              <div className="hg-modal__field">
                <label className="hg-modal__label">Status</label>
                <select className="nv-input" value={hgAddStatus}
                  onChange={e => setHgAddStatus(e.target.value as 'prospect' | 'onboarding')}>
                  <option value="prospect">prospect</option>
                  <option value="onboarding">onboarding</option>
                </select>
                <p className="hg-modal__hint">
                  New groups start as <strong>Prospect</strong>. Move to <strong>Onboarding</strong> once you've engaged the client.
                </p>
              </div>

              {hgAddError && <div className="wizard-error">{hgAddError}</div>}
            </div>

            <div className="hg-modal__footer">
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--md"
                onClick={() => setHgAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="nv-btn nv-btn--solid nv-btn--md"
                disabled={hgAddSaving}
                onClick={submitAddHotelGroup}>
                {hgAddSaving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .hg-search { position: relative; }
        .hg-dropdown {
          position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
          background: white; border: 1px solid var(--nv-border); border-radius: 10px;
          max-height: 220px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.08);
        }
        .hg-dropdown__item {
          display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
          padding: 10px 14px; background: none; border: none; cursor: pointer; font-size: 13px;
        }
        .hg-dropdown__item:hover { background: var(--nv-platinum); }
        .hg-dropdown__item--muted { color: var(--nv-text-muted); cursor: default; }
        .hg-dropdown__item--muted:hover { background: none; }
        .hg-dropdown__item--add {
          color: var(--nv-error); font-weight: 600;
          border-top: 1px solid var(--nv-border-hair);
        }
        .hg-dropdown__meta { font-size: 11px; color: var(--nv-text-muted); }
        .hg-selected {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; border: 1.5px solid var(--nv-border); border-radius: var(--nv-radius-md);
          font-size: 14px;
        }
        .hg-selected code { font-size: 11px; color: var(--nv-text-muted); margin-left: 6px; }
        .hg-modal-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(30,40,45,0.45);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
        }
        .hg-modal {
          width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto;
          background: var(--nv-surface-card); border-radius: var(--nv-radius-md);
          box-shadow: var(--nv-shadow-md);
        }
        .hg-modal__header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 24px 28px; border-bottom: 1px solid var(--nv-border-hair);
        }
        .hg-modal__header h3 {
          margin: 0; font-family: var(--font-comfortaa); font-size: 22px;
          font-weight: 700; color: var(--nv-text-heading);
        }
        .hg-modal__close {
          background: none; border: none; cursor: pointer; font-size: 22px;
          line-height: 1; color: var(--nv-text-muted); padding: 4px;
        }
        .hg-modal__close:hover { color: var(--nv-text-body); }
        .hg-modal__body { padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; }
        .hg-modal__field { display: flex; flex-direction: column; gap: 8px; }
        .hg-modal__label {
          font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--nv-text-muted);
        }
        .hg-modal__hint { margin: 0; font-size: 12px; color: var(--nv-text-muted); line-height: 1.5; }
        .hg-modal__footer {
          display: flex; justify-content: flex-end; gap: 12px;
          padding: 20px 28px; border-top: 1px solid var(--nv-border-hair);
        }
      `}</style>
    </div>
  )
}

/* ─── Step 2: Services ─── */
const SERVICE_DEFS = [
  { code: 'RM' as ServiceCode, name: 'Revenue Management',  desc: 'Full RM strategy, pricing, OTA management' },
  { code: 'SM' as ServiceCode, name: 'Sales Management',    desc: 'Corporate sales, MICE, pro-active outreach' },
  { code: 'MK' as ServiceCode, name: 'Marketing',           desc: 'Digital marketing, content, campaigns' },
  { code: 'CR' as ServiceCode, name: 'Concierge Revenue',   desc: 'Upselling, packages, ancillary revenue' },
]

function Step2Services({ draft, setDraft, errors }: StepProps) {
  function toggle(code: ServiceCode) {
    setDraft(d => ({
      ...d,
      services: d.services.some(s => s.code === code)
        ? d.services.filter(s => s.code !== code)
        : [...d.services, { code, monthlyFee: 0, setupFee: 0, term: 12 }],
    }))
  }

  function updateFee(code: ServiceCode, field: 'monthlyFee' | 'setupFee' | 'term', val: number) {
    setDraft(d => ({
      ...d,
      services: d.services.map(s => s.code === code ? { ...s, [field]: val } : s),
    }))
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Services</h2>
      <p className="step-desc">Select the services to include in this proposal and set pricing.</p>

      {errors.services && <div style={{color:'var(--nv-error)',fontSize:13,marginBottom:12}}>{errors.services}</div>}

      <div className="services-grid">
        {SERVICE_DEFS.map(svc => {
          const selected = draft.services.find(s => s.code === svc.code)
          return (
            <div key={svc.code}
              className={`service-card ${selected ? 'service-card--selected' : ''}`}
              onClick={() => toggle(svc.code)}
            >
              <div className="service-card__header">
                <span className="service-card__badge">{svc.code}</span>
                <input type="checkbox" checked={!!selected}
                  className="service-card__check"
                  onClick={e => e.stopPropagation()}
                  onChange={() => toggle(svc.code)} />
              </div>
              <div className="service-card__name">{svc.name}</div>
              <div className="service-card__desc">{svc.desc}</div>

              {selected && (
                <div className="service-card__pricing" onClick={e => e.stopPropagation()}>
                  <label>
                    Monthly fee (AUD)
                    <input className="nv-input nv-input--sm" type="number" min={0}
                      value={selected.monthlyFee}
                      onChange={e => updateFee(svc.code, 'monthlyFee', +e.target.value)} />
                  </label>
                  <label>
                    Setup fee
                    <input className="nv-input nv-input--sm" type="number" min={0}
                      value={selected.setupFee}
                      onChange={e => updateFee(svc.code, 'setupFee', +e.target.value)} />
                  </label>
                  <label>
                    Term (months)
                    <select className="nv-input nv-input--sm" value={selected.term}
                      onChange={e => updateFee(svc.code, 'term', +e.target.value)}>
                      {[3,6,12,24].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style jsx>{`
        .services-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          margin-top: 8px;
        }
        @media (max-width: 600px) { .services-grid { grid-template-columns: 1fr; } }

        .service-card {
          border: 1.5px solid var(--nv-border);
          border-radius: var(--nv-radius-md);
          padding: 16px;
          cursor: pointer;
          transition: border-color var(--nv-dur), background var(--nv-dur);
        }
        .service-card:hover { border-color: var(--nv-steel-blue); }
        .service-card--selected {
          border-color: var(--nv-blue-slate);
          background: rgba(40,104,127,0.04);
        }

        .service-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .service-card__badge {
          background: var(--nv-blue-slate);
          color: white;
          border-radius: 6px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        .service-card__check {
          width: 16px;
          height: 16px;
          accent-color: var(--nv-blue-slate);
        }
        .service-card__name {
          font-weight: 600;
          color: var(--nv-text-heading);
          font-size: 15px;
          margin-bottom: 4px;
        }
        .service-card__desc {
          font-size: 12px;
          color: var(--nv-text-muted);
          line-height: 1.5;
        }
        .service-card__pricing {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--nv-border-hair);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .service-card__pricing label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--nv-text-muted);
          font-weight: 500;
        }
        .nv-input--sm { padding: 6px 10px; font-size: 13px; }
      `}</style>
    </div>
  )
}

/* ─── Step 3: Sender ─── */
function Step3Sender({ draft, setDraft, errors, staff = [], staffLoading, staffError }: StepProps) {
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError]     = useState('')

  async function handleGenerateEmail() {
    setGenerating(true)
    setGenError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/generate-email-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          staffId:      draft.sender.staffId,
          contactName:  draft.hotel.contactName,
          contactTitle: draft.hotel.contactTitle,
          hotelName:    draft.hotel.name,
          serviceCodes: draft.services.map(s => s.code),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to generate email template')
      setDraft(d => ({ ...d, sender: { ...d.sender, message: data.data.message } }))
    } catch (e: any) {
      setGenError(e.message || 'Failed to generate email template')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Sender</h2>
      <p className="step-desc">Choose who this proposal is sent from and add a personal message.</p>

      <div className="form-grid">
        <FormField label="Sending on behalf of *" error={errors.staffId || staffError} span={2}>
          <select className="nv-input"
            disabled={staffLoading}
            value={draft.sender.staffId}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, staffId: e.target.value } }))}>
            <option value="">
              {staffLoading ? 'Loading Microsoft 365 users…' : 'Select team member…'}
            </option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.role_type}{s.m365_upn ? ` (${s.m365_upn})` : ''}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Personal message (appears in email & proposal intro)" span={2}>
          <textarea className="nv-input" rows={4}
            placeholder="e.g. Hi Sarah, it was great speaking with you today…"
            value={draft.sender.message}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, message: e.target.value } }))} />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="nv-btn nv-btn--outlined nv-btn--sm"
              onClick={handleGenerateEmail}
              disabled={generating || !draft.hotel.contactName}
              aria-busy={generating}
              title={!draft.hotel.contactName ? 'Enter a contact name in Hotel Details first' : undefined}
            >
              {generating ? 'Generating…' : '✦ Generate Email Template'}
            </button>
            {genError && <span style={{ color: 'var(--nv-error)', fontSize: 12, marginLeft: 10 }}>{genError}</span>}
          </div>
        </FormField>
      </div>
    </div>
  )
}

/* ─── Step 4: Cover Image ─── */
function Step4Cover({ draft, setDraft, errors }: StepProps) {
  const COVER_OPTIONS = [
    { url: '/covers/luxury-hotel-lobby.jpg',     label: 'Luxury Lobby'    },
    { url: '/covers/modern-hotel-exterior.jpg',  label: 'Modern Exterior' },
    { url: '/covers/pool-terrace.jpg',           label: 'Pool Terrace'    },
    { url: '/covers/conference-room.jpg',        label: 'Conference'      },
  ]
  return (
    <div className="step-content">
      <h2 className="step-title">Cover Image</h2>
      <p className="step-desc">
        Choose a cover photo for the proposal — or leave as default.
        You can also upload a custom image specific to this property.
      </p>

      <div className="cover-grid">
        {COVER_OPTIONS.map(opt => (
          <button
            key={opt.url}
            className={`cover-option ${draft.cover.coverUrl === opt.url ? 'cover-option--selected' : ''}`}
            onClick={() => setDraft(d => ({ ...d, cover: { ...d.cover, coverUrl: opt.url } }))}
          >
            <div className="cover-option__img" style={{ background: 'var(--nv-platinum)' }}>
              <span style={{ fontSize: 28 }}>🏨</span>
            </div>
            <span className="cover-option__label">{opt.label}</span>
          </button>
        ))}
      </div>

      <label className="cover-upload">
        <input type="file" accept="image/*" hidden
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              const url = URL.createObjectURL(file)
              setDraft(d => ({ ...d, cover: { ...d.cover, coverUrl: url, uploadFile: file } }))
            }
          }} />
        <span className="nv-btn nv-btn--outlined nv-btn--sm">↑ Upload custom image</span>
      </label>

      <style jsx>{`
        .cover-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin: 16px 0;
        }
        @media (max-width: 600px) { .cover-grid { grid-template-columns: repeat(2, 1fr); } }

        .cover-option {
          border: 2px solid var(--nv-border);
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          background: none;
          padding: 0;
          transition: border-color var(--nv-dur);
          display: flex;
          flex-direction: column;
        }
        .cover-option:hover { border-color: var(--nv-steel-blue); }
        .cover-option--selected { border-color: var(--nv-blue-slate); }

        .cover-option__img {
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cover-option__label {
          padding: 8px;
          font-size: 12px;
          color: var(--nv-text-muted);
          text-align: center;
        }

        .cover-upload { display: block; }
      `}</style>
    </div>
  )
}

/* ─── Step 5: Preview & Send ─── */
function Step5Preview({ draft, setDraft, errors }: StepProps) {
  const total = draft.services.reduce((acc, s) => acc + s.monthlyFee * s.term + s.setupFee, 0)
  return (
    <div className="step-content">
      <h2 className="step-title">Preview & Send</h2>
      <p className="step-desc">Review proposal details and confirm before generating the PDF and sending.</p>

      <div className="preview-summary">
        <SummaryRow label="Hotel"    value={draft.hotel.name || '—'} />
        <SummaryRow label="Contact"  value={`${draft.hotel.contactName} — ${draft.hotel.contactEmail}`} />
        <SummaryRow label="Services" value={draft.services.map(s => s.code).join(', ') || '—'} />
        <SummaryRow label="Total value" value={`$${total.toLocaleString('en-AU')}`} bold />
        <SummaryRow label="Sending as" value={draft.sender.staffId || '—'} />
      </div>

      <FormField label="Send proposal to (confirm email) *" error={errors.recipientEmail}>
        <input className="nv-input" type="email"
          value={draft.preview.recipientEmail || draft.hotel.contactEmail}
          onChange={e => setDraft(d => ({ ...d, preview: { ...d.preview, recipientEmail: e.target.value } }))} />
      </FormField>

      <div className="preview-note">
        Clicking <strong>Generate &amp; Send</strong> will:
        create the proposal PDF · upload to R2 · send the email · trigger HubSpot / Asana automations.
      </div>

      <style jsx>{`
        .preview-summary {
          border: 1px solid var(--nv-border-hair);
          border-radius: 10px;
          overflow: hidden;
          margin-bottom: 24px;
        }
        .preview-note {
          margin-top: 16px;
          padding: 12px 16px;
          background: rgba(40,104,127,0.05);
          border-radius: 10px;
          font-size: 13px;
          color: var(--nv-text-muted);
          line-height: 1.6;
        }
      `}</style>
    </div>
  )
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      padding: '10px 16px',
      borderBottom: '1px solid var(--nv-border-hair)',
      fontSize: 13,
    }}>
      <span style={{ width: 140, color: 'var(--nv-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--nv-text-body)', fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  )
}

/* ─── Shared form helpers ─── */
interface M365Staff {
  id:         string
  name:       string
  email:      string
  role:       string
  role_type:  string
  m365_upn?:  string
}

interface StepProps {
  draft: ProposalDraft
  setDraft: React.Dispatch<React.SetStateAction<ProposalDraft>>
  errors: Record<string, string>
  staff?: M365Staff[]
  staffLoading?: boolean
  staffError?: string
}

function FormField({ label, error, children, span }: {
  label: string; error?: string; children: React.ReactNode; span?: number
}) {
  return (
    <div className="form-field" style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <label className="form-field__label">{label}</label>
      {children}
      {error && <span className="form-field__error">{error}</span>}
      <style jsx>{`
        .form-field { display: flex; flex-direction: column; gap: 6px; }
        .form-field__label { font-size: 13px; font-weight: 600; color: var(--nv-text-body); }
        .form-field__error { font-size: 12px; color: var(--nv-error); }
      `}</style>
    </div>
  )
}

/* Common styles for step content */
const stepStyles = `
  .step-content { display: flex; flex-direction: column; gap: 20px; }
  .step-title {
    font-family: var(--font-comfortaa);
    font-size: 22px;
    font-weight: 700;
    color: var(--nv-text-heading);
    margin-bottom: 2px;
  }
  .step-desc { font-size: 14px; color: var(--nv-text-muted); line-height: 1.55; }
  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
`

/* Inject step styles once */
if (typeof document !== 'undefined') {
  if (!document.getElementById('wizard-step-styles')) {
    const s = document.createElement('style')
    s.id = 'wizard-step-styles'
    s.textContent = stepStyles
    document.head.appendChild(s)
  }
}

/* ─── Validation ─── */
function validateStep(draft: ProposalDraft): Record<string, string> {
  const errs: Record<string, string> = {}
  if (draft.step === 1) {
    if (!draft.hotel.hgid || !draft.hotel.entityCode)
                                    errs.hgid         = 'Select a hotel group from the registry lookup'
    if (!draft.hotel.name)          errs.hotelName    = 'Hotel name is required'
    if (!draft.hotel.contactName)   errs.contactName  = 'Contact name is required'
    if (!draft.hotel.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.hotel.contactEmail))
      errs.contactEmail = 'Valid email required'
  }
  if (draft.step === 2 && draft.services.length === 0) {
    errs.services = 'Please select at least one service'
  }
  if (draft.step === 3 && !draft.sender.staffId) {
    errs.staffId = 'Please select a sender'
  }
  return errs
}
