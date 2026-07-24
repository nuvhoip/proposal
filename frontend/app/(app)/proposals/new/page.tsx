'use client'

import React, { useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  ProposalDraft, ServiceCode, Region, DraftServiceLine, ScopeItem, FeeRow,
  PricingFootnote, TermsClause, FeeType,
} from '@/lib/types'
import {
  SERVICE_CATALOG, FEE_TYPES, REGION_META, initScopeItems, initFeeRows,
  initFootnotes, initTerms, generateRowId, deriveFeeSummary,
} from '@/lib/serviceCatalog'
import { buildDocModelFromDraft, downloadBlob } from '@/lib/documentModel'
import { ProposalDocument } from '@/components/proposal/ProposalDocument'
import { buildDocxFile } from '@/lib/exportDocx'

const STEPS = [
  { id: 1, label: 'Hotel Details'  },
  { id: 2, label: 'Services'       },
  { id: 3, label: 'Scope'          },
  { id: 4, label: 'Pricing'        },
  { id: 5, label: 'Sender'         },
  { id: 6, label: 'Cover Image'    },
  { id: 7, label: 'Terms'          },
  { id: 8, label: 'Preview & Send' },
]

const EMPTY_DRAFT: ProposalDraft = {
  step: 1,
  hotel: {
    name: '', region: 'au', hgid: '', pid: '', entityCode: '', contactName: '', contactEmail: '',
    contactPhone: '', contactTitle: '', propertyAddress: '',
    hubspotDealId: '', hubspotCompanyId: '', hubspotContactId: '',
  },
  services:     [],
  sender:       { staffId: '', accountManagerId: '', message: '' },
  cover:        { coverUrl: '' },
  terms:        initTerms('au'),
  preview:      { recipientEmail: '' },
}

export default function NewProposalPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('edit')
  const [draft, setDraft]       = useState<ProposalDraft>(EMPTY_DRAFT)
  const [saving, setSaving]     = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [staff, setStaff]       = useState<M365Staff[]>([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [staffError, setStaffError]     = useState('')
  const [loadingExisting, setLoadingExisting] = useState(!!editId)

  const step = draft.step

  // Edit mode — /proposals/new?edit={id} loads the existing proposal and
  // pre-fills the wizard. Editing is only permitted while status === 'draft'
  // (enforced server-side in updateProposal()); hgid/entity_code come from
  // proposal_registry_links via getProposal() since they aren't columns on
  // proposals itself.
  React.useEffect(() => {
    if (!editId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${editId}`, {
          credentials: 'include',
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load proposal')
        if (cancelled) return
        const p = data.data
        setDraft({
          step: 1,
          hotel: {
            name: p.hotel_name || '', region: (p.region || 'au') as Region,
            hgid: p.hgid || '', pid: p.pid || '', entityCode: p.entity_code || '',
            contactName: p.contact_name || '', contactEmail: p.contact_email || '',
            contactPhone: p.contact_phone || '', contactTitle: p.contact_title || '',
            propertyAddress: p.property_address || '', hubspotDealId: p.hubspot_deal_id || '',
            hubspotCompanyId: p.hubspot_company_id || '', hubspotContactId: p.hubspot_contact_id || '',
          },
          services: (p.services || []).map((s: any) => ({
            code:       s.code as ServiceCode,
            monthlyFee: s.monthly_fee,
            setupFee:   s.setup_fee,
            term:       s.term_months,
            scopeItems: Array.isArray(s.scope_items) && s.scope_items.length
              ? s.scope_items : initScopeItems(s.code as ServiceCode),
            feeRows: Array.isArray(s.fee_rows) && s.fee_rows.length
              ? s.fee_rows : initFeeRows(s.code as ServiceCode),
            footnotes: Array.isArray(s.footnotes) && s.footnotes.length
              ? s.footnotes : initFootnotes(s.code as ServiceCode),
          })),
          sender:  {
            staffId: p.sender_staff_id || '',
            accountManagerId: p.account_manager_stf_id || '',
            message: p.sender_message || '',
          },
          cover:   { coverUrl: p.cover_url || '' },
          // Spread over initTerms() defaults, not just `p.terms || initTerms(...)`,
          // so proposals saved before signatureMethod/signatureDataUrl existed
          // (or before the Worker migration adding those D1 columns has run)
          // still load with valid defaults instead of undefined fields.
          terms: { ...initTerms((p.region || 'au') as Region), ...(p.terms || {}) },
          preview: { recipientEmail: p.contact_email || '' },
        })
      } catch (e: any) {
        if (!cancelled) setErrors({ submit: e.message || 'Failed to load proposal for editing' })
      } finally {
        if (!cancelled) setLoadingExisting(false)
      }
    })()
    return () => { cancelled = true }
  }, [editId])

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
    setDraft(d => ({ ...d, step: Math.min(STEPS.length, d.step + 1) }))
  }
  function goBack() {
    setErrors({})
    setDraft(d => ({ ...d, step: Math.max(1, d.step - 1) }))
  }

  async function createDraftProposal(): Promise<string> {
    if (editId) {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          hotel_name:       draft.hotel.name,
          contact_name:     draft.hotel.contactName,
          contact_email:    draft.hotel.contactEmail,
          contact_phone:    draft.hotel.contactPhone,
          contact_title:    draft.hotel.contactTitle,
          property_address: draft.hotel.propertyAddress,
          region:           draft.hotel.region,
          sender_staff_id:  draft.sender.staffId,
          account_manager_stf_id: draft.sender.accountManagerId || null,
          sender_message:   draft.sender.message,
          cover_url:        draft.cover.coverUrl,
          hubspot_deal_id:  draft.hotel.hubspotDealId,
          services:         draft.services,
          terms:            draft.terms,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update proposal')
      return editId
    }

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

  if (loadingExisting) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 64 }}>
        <div className="nv-spinner" />
      </div>
    )
  }

  return (
    <div className="wizard-page">
      {editId && (
        <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--nv-text-muted)' }}>
          Editing existing proposal
        </div>
      )}
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
            <Step3Scope draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 4 && (
            <Step4Pricing draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 5 && (
            <Step5Sender
              draft={draft} setDraft={setDraft} errors={errors}
              staff={staff} staffLoading={staffLoading} staffError={staffError}
            />
          )}
          {step === 6 && (
            <Step6Cover draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 7 && (
            <Step7Terms draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 8 && (
            <Step8Preview draft={draft} setDraft={setDraft} errors={errors} staff={staff} />
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
            {step < STEPS.length
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

// Hardcoded fallback for the Market picker — mirrors registry.market_codes
// (confirmed against the live DB) while GET /v1/ref/markets is unreachable
// from the wizard (the registry runs on DigitalOcean App Platform; the
// live endpoint isn't returning data at the moment). Remove once that's
// fixed and swap the two effects below back to a live fetch.
const MARKETS_BY_GEO: Record<string, { market: string; label: string }[]> = {
  AU: [
    { market: 'ADL', label: 'Adelaide' },
    { market: 'BNE', label: 'Brisbane' },
    { market: 'CBR', label: 'Canberra' },
    { market: 'GCS', label: 'Gold Coast' },
    { market: 'MEL', label: 'Melbourne' },
    { market: 'PER', label: 'Perth' },
    { market: 'SYD', label: 'Sydney' },
  ],
  IE: [
    { market: 'CRK', label: 'Cork' },
    { market: 'DUB', label: 'Dublin' },
  ],
  UK: [
    { market: 'BHM', label: 'Birmingham' },
    { market: 'EDI', label: 'Edinburgh' },
    { market: 'LON', label: 'London' },
    { market: 'MCR', label: 'Manchester' },
  ],
}

interface HubspotSearchResult {
  id:   string
  type: 'company' | 'contact'
  name: string
  sub:  string
  hgid: string | null
  pid:  string | null
}

interface RegistryPropertySummary {
  pid:           string
  hgid:          string
  property_name: string
  brand:         string | null
  geo:           string
  market:        string
  status:        string
}

interface RegistryMarket {
  market:    string
  geo:       string
  label:     string
  is_active: boolean
}

// Combined search result — the unified box below queries the Master
// Registry and HubSpot in parallel and shows both, tagged by source.
// Reconciliation between the two systems happens after a pick (keyed by
// hgid/pid/hubspot_id), not by fuzzy-matching names across the two lists.
type CombinedResult =
  | { source: 'registry'; hg: RegistryHotelGroupSummary }
  | { source: 'hubspot';  hs: HubspotSearchResult }

function Step1HotelDetails({ draft, setDraft, errors }: StepProps) {
  const h = draft.hotel
  function update(key: string, val: string) {
    setDraft(d => ({ ...d, hotel: { ...d.hotel, [key]: val } }))
  }

  const [acctQuery, setAcctQuery]   = useState(h.hgid ? h.name : '')
  const [acctOpen, setAcctOpen]     = useState(false)
  const [acctLoading, setAcctLoading] = useState(false)
  const [regResults, setRegResults] = useState<RegistryHotelGroupSummary[]>([])
  const [hsResults, setHsResults]   = useState<HubspotSearchResult[]>([])
  const [hgResolveError, setHgResolveError] = useState('')

  // Single search box — replaces the old separate "HubSpot" box and "Hotel
  // Group" box. Queries the registry typeahead (scoped to the chosen region)
  // and HubSpot companies+contacts in parallel; both lists render together.
  React.useEffect(() => {
    if (h.hgid || acctQuery.trim().length < 2) { setRegResults([]); setHsResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setAcctLoading(true)
      try {
        const [regRes, hsRes] = await Promise.all([
          fetch(
            `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/typeahead?${new URLSearchParams({ q: acctQuery.trim(), geo: h.region.toUpperCase() })}`,
            { credentials: 'include' }
          ).then(r => r.json()).catch(() => null),
          fetch(
            `${process.env.NEXT_PUBLIC_WORKER_URL}/hubspot/search?${new URLSearchParams({ q: acctQuery.trim() })}`,
            { credentials: 'include' }
          ).then(r => r.json()).catch(() => null),
        ])
        if (cancelled) return
        setRegResults(regRes?.data?.results || [])
        setHsResults((hsRes?.data?.results || []).filter((r: HubspotSearchResult) => r.type === 'company'))
      } catch {
        if (!cancelled) { setRegResults([]); setHsResults([]) }
      } finally {
        if (!cancelled) setAcctLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [acctQuery, h.region, h.hgid])

  // ── Sync modal — reconciles whichever side (Registry / HubSpot) is
  // missing once an account is picked or created. Two directions:
  //  - toHubspot: hgid is known, no linked HubSpot company yet.
  //  - toRegistry: a HubSpot company is known, no registry hgid yet.
  const [syncOpen, setSyncOpen]         = useState(false)
  const [syncDirection, setSyncDirection] = useState<'toHubspot' | 'toRegistry' | null>(null)
  const [syncSaving, setSyncSaving]     = useState(false)
  const [syncError, setSyncError]       = useState('')
  const [syncCompanyId, setSyncCompanyId]     = useState('')   // toRegistry: the existing HubSpot company id
  const [syncCompanyName, setSyncCompanyName] = useState('')
  const [syncHgid, setSyncHgid]         = useState('')          // toHubspot: the already-resolved hgid
  const [syncExistingProps, setSyncExistingProps] = useState<RegistryPropertySummary[]>([])
  const [syncPickedPid, setSyncPickedPid]   = useState('')      // toHubspot: pid of an existing property, if any
  const [syncPropertyName, setSyncPropertyName] = useState('')  // used when a new property must be created
  const [syncMarket, setSyncMarket]     = useState('')
  const [syncMarkets, setSyncMarkets]   = useState<RegistryMarket[]>([])
  // toRegistry also needs a legal entity, same as the "Add Hotel Group" flow
  const [syncEntityCode, setSyncEntityCode] = useState('')
  const [syncEntities, setSyncEntities]     = useState<RegistryEntity[]>([])

  const syncGeoEntities = syncEntities.filter(e => {
    if (!e.is_data_controller || !e.is_active) return false
    const prefix = REGION_JURISDICTION_PREFIX[h.region]
    return e.jurisdiction.trim().toLowerCase().startsWith(prefix)
  })

  React.useEffect(() => {
    if (!syncOpen) return
    let cancelled = false
    ;(async () => {
      try {
        // Market list is hardcoded for now — see MARKETS_BY_GEO above.
        const markets = (MARKETS_BY_GEO[h.region.toUpperCase()] || []).map(m => ({
          ...m, geo: h.region.toUpperCase(), is_active: true,
        }))
        if (!cancelled) {
          setSyncMarkets(markets)
          if (markets.length === 1) setSyncMarket(markets[0].market)
          if (markets.length === 0) {
            setSyncError(`No markets configured for ${h.region.toUpperCase()} — add one to MARKETS_BY_GEO.`)
          }
        }
        if (syncDirection === 'toHubspot' && syncHgid) {
          const propsRes = await fetch(
            `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${syncHgid}/properties`,
            { credentials: 'include' }
          ).then(r => r.json())
          if (!cancelled) {
            const props = propsRes?.data?.properties || []
            setSyncExistingProps(props)
            if (props.length === 1) setSyncPickedPid(props[0].pid)
          }
        }
        if (syncDirection === 'toRegistry') {
          const entRes = await fetch(
            `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/entities`,
            { credentials: 'include' }
          ).then(r => r.json())
          if (!cancelled) setSyncEntities(entRes?.data?.entities || [])
        }
      } catch (e) {
        if (!cancelled) setSyncError(e instanceof Error ? e.message : 'Could not load registry reference data.')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOpen, syncDirection, syncHgid, h.region])

  React.useEffect(() => {
    if (syncDirection === 'toRegistry' && syncGeoEntities.length === 1) setSyncEntityCode(syncGeoEntities[0].entity_code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncEntities, syncDirection])

  // Opened when a Registry hotel group is picked/created with no hubspot_id yet.
  function openSyncToHubspot(hgid: string, name: string) {
    setSyncDirection('toHubspot')
    setSyncHgid(hgid)
    setSyncCompanyName(name)
    setSyncPropertyName(name)
    setSyncPickedPid('')
    setSyncMarket('')
    setSyncError('')
    setSyncOpen(true)
  }

  // Opened when a HubSpot company is picked with no hgid property set yet.
  function openSyncToRegistry(companyId: string, name: string) {
    setSyncDirection('toRegistry')
    setSyncCompanyId(companyId)
    setSyncCompanyName(name)
    setSyncPropertyName(name)
    setSyncMarket('')
    setSyncEntityCode('')
    setSyncError('')
    setSyncOpen(true)
  }

  async function submitSync() {
    setSyncError('')
    if (syncDirection === 'toHubspot') {
      let pid = syncPickedPid
      setSyncSaving(true)
      try {
        // Create a property (and its pid) if none was picked from an existing list.
        if (!pid) {
          if (!syncPropertyName.trim()) throw new Error('Property name is required.')
          if (!syncMarket) throw new Error('Select a market.')
          const propRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/properties`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hgid: syncHgid, entity_code: h.entityCode, property_name: syncPropertyName.trim(),
              geo: h.region.toUpperCase(), market: syncMarket,
            }),
          })
          const propData = await propRes.json()
          if (!propRes.ok || propData.success === false) {
            throw new Error(propData.error?.message || propData.error || 'Could not create the property record.')
          }
          pid = propData.data?.property?.pid
        }
        // Create the HubSpot Company with hgid+pid set directly.
        const companyRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/hubspot/clients`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            companyName: syncCompanyName.trim() || h.name, contactName: h.contactName,
            contactEmail: h.contactEmail, contactPhone: h.contactPhone, region: h.region,
            hgid: syncHgid, pid,
          }),
        })
        const companyData = await companyRes.json()
        if (!companyRes.ok || companyData.success === false) {
          throw new Error(companyData.error?.message || companyData.error || 'Could not create the HubSpot company.')
        }
        const { companyId, contactId } = companyData.data || {}
        // Write the link back onto the registry hotel group.
        await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${syncHgid}`, {
          method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hubspot_id: companyId }),
        })
        setDraft(d => ({
          ...d,
          hotel: { ...d.hotel, pid: pid || d.hotel.pid, hubspotCompanyId: companyId || '', hubspotContactId: contactId || d.hotel.hubspotContactId },
        }))
        setSyncOpen(false)
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : 'Could not add this account to HubSpot.')
      } finally {
        setSyncSaving(false)
      }
      return
    }

    if (syncDirection === 'toRegistry') {
      setSyncSaving(true)
      try {
        if (!syncEntityCode) throw new Error('Select the legal entity for this hotel group.')
        if (!syncMarket) throw new Error('Select a market.')
        const hgRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group_name: syncCompanyName.trim() || h.name, entity_code: syncEntityCode,
            geo: h.region.toUpperCase(), status: 'prospect',
          }),
        })
        const hgData = await hgRes.json()
        if (!hgRes.ok || hgData.success === false) {
          throw new Error(hgData.error?.message || 'Could not save this hotel group to the master registry.')
        }
        const hg = hgData.data?.hotelGroup
        const propRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/properties`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hgid: hg.hgid, entity_code: syncEntityCode, property_name: syncPropertyName.trim() || h.name,
            geo: h.region.toUpperCase(), market: syncMarket,
          }),
        })
        const propData = await propRes.json()
        if (!propRes.ok || propData.success === false) {
          throw new Error(propData.error?.message || propData.error || 'Could not create the property record.')
        }
        const pid = propData.data?.property?.pid
        // Write hgid+pid back onto the HubSpot company, and hubspot_id onto the new hotel group.
        await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/hubspot/companies/${syncCompanyId}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hgid: hg.hgid, pid }),
          }),
          fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${hg.hgid}`, {
            method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hubspot_id: syncCompanyId }),
          }),
        ])
        setDraft(d => ({
          ...d,
          hotel: {
            ...d.hotel, hgid: hg.hgid, pid, entityCode: syncEntityCode,
            hubspotCompanyId: syncCompanyId, name: d.hotel.name || hg.group_name,
          },
        }))
        setAcctQuery(hg.group_name)
        setSyncOpen(false)
      } catch (e) {
        setSyncError(e instanceof Error ? e.message : 'Could not add this account to the master registry.')
      } finally {
        setSyncSaving(false)
      }
    }
  }

  // Registry result picked — resolve the full record (for entity_code) and
  // check hubspot_id to decide whether the HubSpot side still needs syncing.
  async function selectRegistryResult(hg: RegistryHotelGroupSummary) {
    setAcctOpen(false)
    setAcctQuery(hg.trading_name || hg.group_name)
    setHgResolveError('')
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${hg.hgid}`,
        { credentials: 'include' }
      )
      const data = await res.json()
      const record = data.data?.hotelGroup
      if (!record?.entity_code) throw new Error('No entity_code on this hotel group')
      setDraft(d => ({
        ...d,
        hotel: {
          ...d.hotel, hgid: hg.hgid, entityCode: record.entity_code,
          name: d.hotel.name || hg.trading_name || hg.group_name,
          hubspotCompanyId: record.hubspot_id || d.hotel.hubspotCompanyId,
        },
      }))
      if (!record.hubspot_id) {
        // In the registry, not (yet) linked to HubSpot.
        openSyncToHubspot(hg.hgid, hg.trading_name || hg.group_name)
      }
    } catch {
      setHgResolveError('Could not resolve entity code for this hotel group — try again.')
    }
  }

  // HubSpot company picked — if it already carries an hgid property, it's
  // linked; otherwise offer to add it to the Master Registry.
  function selectHubspotResult(r: HubspotSearchResult) {
    setAcctOpen(false)
    setAcctQuery(r.name)
    setDraft(d => ({ ...d, hotel: { ...d.hotel, name: d.hotel.name || r.name, hubspotCompanyId: r.id, pid: r.pid || d.hotel.pid } }))
    if (r.hgid) {
      // Already linked — resolve entity_code from the registry side too.
      fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${r.hgid}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          const record = data.data?.hotelGroup
          if (record?.entity_code) {
            setDraft(d => ({ ...d, hotel: { ...d.hotel, hgid: r.hgid!, entityCode: record.entity_code } }))
          }
        })
        .catch(() => {})
    } else {
      openSyncToRegistry(r.id, r.name)
    }
  }

  function clearHotelGroup() {
    setDraft(d => ({ ...d, hotel: { ...d.hotel, hgid: '', pid: '', entityCode: '', hubspotCompanyId: '' } }))
    setAcctQuery('')
    setHgResolveError('')
  }

  // Add Hotel Group — used when the unified search turns up no existing
  // match anywhere. Creates the registry hotel group + property (pid) and,
  // once created, immediately opens the HubSpot sync prompt for it.
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

  // Market picker for the property created alongside a brand-new hotel group.
  const [hgAddMarket, setHgAddMarket]   = useState('')
  const [hgAddMarkets, setHgAddMarkets] = useState<RegistryMarket[]>([])
  React.useEffect(() => {
    if (!hgAddOpen) return
    // Market list is hardcoded for now — see MARKETS_BY_GEO above.
    const markets = (MARKETS_BY_GEO[hgAddGeo.toUpperCase()] || []).map(m => ({
      ...m, geo: hgAddGeo.toUpperCase(), is_active: true,
    }))
    setHgAddMarkets(markets)
    setHgAddMarket(markets.length === 1 ? markets[0].market : '')
    if (markets.length === 0) {
      setHgAddError(`No markets configured for ${hgAddGeo.toUpperCase()} — add one to MARKETS_BY_GEO.`)
    }
  }, [hgAddOpen, hgAddGeo])

  function openAddHotelGroup() {
    setHgAddGroupName(acctQuery.trim())
    setHgAddTradingName('')
    setHgAddGeo(h.region)
    setHgAddStatus('prospect')
    setHgAddError('')
    setHgAddOpen(true)
    setAcctOpen(false)
  }

  async function submitAddHotelGroup() {
    if (!hgAddGroupName.trim()) { setHgAddError('Group name is required.'); return }
    if (!hgAddEntityCode) { setHgAddError('Select the legal entity for this hotel group.'); return }
    if (!hgAddMarket) { setHgAddError('Select a market.'); return }
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
      // Immediately create the first property under the new group so it has a pid.
      const propRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/properties`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hgid: hg.hgid, entity_code: hgAddEntityCode,
          property_name: hgAddTradingName.trim() || hgAddGroupName.trim(),
          geo: hgAddGeo.toUpperCase(), market: hgAddMarket,
        }),
      })
      const propData = await propRes.json()
      const pid = propRes.ok ? propData.data?.property?.pid : ''
      setDraft(d => ({
        ...d,
        hotel: {
          ...d.hotel,
          hgid: hg.hgid,
          pid: pid || '',
          entityCode: hg.entity_code,
          region: hgAddGeo,
          name: d.hotel.name || hg.trading_name || hg.group_name,
        },
      }))
      setAcctQuery(hg.trading_name || hg.group_name)
      setHgAddOpen(false)
      // New group has no HubSpot link yet — offer to add it now.
      openSyncToHubspot(hg.hgid, hg.trading_name || hg.group_name)
    } catch (e) {
      setHgAddError(e instanceof Error ? e.message : 'Could not save this hotel group.')
    } finally {
      setHgAddSaving(false)
    }
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Hotel Details</h2>
      <p className="step-desc">Enter the hotel and primary contact information.</p>

      {/* Region comes first — the account search below is scoped to it. */}
      <div className="form-grid">
        <FormField label="Where is the hotel? *" error={errors.region} span={2}>
          <select className="nv-input" value={h.region}
            onChange={e => { update('region', e.target.value); clearHotelGroup() }}>
            <option value="au">Australia</option>
            <option value="uk">United Kingdom</option>
            <option value="ie">Ireland</option>
          </select>
        </FormField>
      </div>

      {/* Unified account search — Master Registry + HubSpot together.
          Replaces the old separate "HubSpot" box above this one. */}
      <div className="hs-section">
        <div className="hs-section__label">Hotel Group / Account</div>
        {h.hgid ? (
          <div className="hg-selected">
            <span>
              {h.name || acctQuery} <code>{h.hgid}</code>{h.pid && <code>{h.pid}</code>}
              {h.hubspotCompanyId && <code>HS {h.hubspotCompanyId}</code>}
            </span>
            <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={clearHotelGroup}>
              Change
            </button>
          </div>
        ) : (
          <div className="hg-search">
            <input className="nv-input" placeholder="Search hotel groups / accounts…"
              value={acctQuery}
              onChange={e => { setAcctQuery(e.target.value); setAcctOpen(true) }}
              onFocus={() => setAcctOpen(true)}
              onBlur={() => setTimeout(() => setAcctOpen(false), 150)} />
            {acctOpen && acctQuery.trim().length >= 2 && (
              <div className="hg-dropdown">
                {acctLoading && <div className="hg-dropdown__item hg-dropdown__item--muted">Searching…</div>}
                {!acctLoading && regResults.length === 0 && hsResults.length === 0 && (
                  <div className="hg-dropdown__item hg-dropdown__item--muted">No matches yet.</div>
                )}
                {regResults.map(hg => (
                  <button type="button" key={`hg-${hg.hgid}`} className="hg-dropdown__item"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => selectRegistryResult(hg)}>
                    <strong>{hg.trading_name || hg.group_name}</strong>
                    <span className="hg-dropdown__meta">Registry · {hg.hgid} · {hg.geo} · {hg.status}</span>
                  </button>
                ))}
                {hsResults.map(r => (
                  <button type="button" key={`hs-${r.id}`} className="hg-dropdown__item"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => selectHubspotResult(r)}>
                    <strong>{r.name}</strong>
                    <span className="hg-dropdown__meta">
                      HubSpot · {r.sub || '—'}{r.hgid ? ` · linked ${r.hgid}` : ' · not in registry'}
                    </span>
                  </button>
                ))}
                <button type="button" className="hg-dropdown__item hg-dropdown__item--add"
                  onMouseDown={e => e.preventDefault()}
                  onClick={openAddHotelGroup}>
                  + Add &quot;{acctQuery.trim()}&quot; as a new hotel group
                </button>
              </div>
            )}
          </div>
        )}
        {errors.hgid || hgResolveError ? (
          <p className="hs-section__hint" style={{ color: 'var(--nv-error)' }}>{errors.hgid || hgResolveError}</p>
        ) : (
          <p className="hs-section__hint">
            Searches both the Nuvho Master Registry and HubSpot. Picking a result from one side that
            isn&apos;t yet linked to the other will prompt you to sync hgid/pid across both.
          </p>
        )}
      </div>

      <div className="form-grid">
        <FormField label="Hotel name *" error={errors.hotelName} span={2}>
          <input className="nv-input" placeholder="e.g. The Langham Sydney"
            value={h.name} onChange={e => update('name', e.target.value)} />
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

      {/* Sync modal — handles both hgid/pid reconciliation directions. */}
      {syncOpen && (
        <div className="hg-modal-overlay" onMouseDown={() => setSyncOpen(false)}>
          <div className="hg-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="hg-modal__header">
              <h3>{syncDirection === 'toHubspot' ? 'Add to HubSpot' : 'Add to Master Registry'}</h3>
              <button type="button" className="hg-modal__close" aria-label="Close"
                onClick={() => setSyncOpen(false)}>
                ×
              </button>
            </div>

            <div className="hg-modal__body">
              {syncDirection === 'toHubspot' && (
                <>
                  <p className="hg-modal__hint">
                    <strong>{syncCompanyName}</strong> (<code>{syncHgid}</code>) exists in the Master Registry
                    but isn&apos;t linked to a HubSpot company yet. Creating one will copy the hotel group id
                    and property id onto it.
                  </p>
                  <div className="hg-modal__field">
                    <label className="hg-modal__label">Company Name *</label>
                    <input className="nv-input" value={syncCompanyName}
                      onChange={e => setSyncCompanyName(e.target.value)} />
                  </div>
                  {syncExistingProps.length > 1 && (
                    <div className="hg-modal__field">
                      <label className="hg-modal__label">Property (pid)</label>
                      <select className="nv-input" value={syncPickedPid} onChange={e => setSyncPickedPid(e.target.value)}>
                        <option value="">+ Create a new property…</option>
                        {syncExistingProps.map(p => (
                          <option key={p.pid} value={p.pid}>{p.property_name} ({p.pid})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!syncPickedPid && (
                    <>
                      <div className="hg-modal__field">
                        <label className="hg-modal__label">Property Name *</label>
                        <input className="nv-input" value={syncPropertyName}
                          onChange={e => setSyncPropertyName(e.target.value)} />
                      </div>
                      <div className="hg-modal__field">
                        <label className="hg-modal__label">Market *</label>
                        <select className="nv-input" value={syncMarket} onChange={e => setSyncMarket(e.target.value)}>
                          <option value="">Select…</option>
                          {syncMarkets.map(m => (
                            <option key={m.market} value={m.market}>{m.label} ({m.market})</option>
                          ))}
                        </select>
                        <p className="hg-modal__hint">A new property (and pid) will be created under this hotel group.</p>
                      </div>
                    </>
                  )}
                </>
              )}

              {syncDirection === 'toRegistry' && (
                <>
                  <p className="hg-modal__hint">
                    <strong>{syncCompanyName}</strong> exists in HubSpot but isn&apos;t in the Master Registry
                    yet. This will generate a new hotel group id and property id, then write both back onto
                    the HubSpot company.
                  </p>
                  <div className="hg-modal__field">
                    <label className="hg-modal__label">Group Name *</label>
                    <input className="nv-input" value={syncCompanyName}
                      onChange={e => setSyncCompanyName(e.target.value)} />
                  </div>
                  <div className="hg-modal__field">
                    <label className="hg-modal__label">Entity Code *</label>
                    <select className="nv-input" value={syncEntityCode} onChange={e => setSyncEntityCode(e.target.value)}>
                      <option value="">Select…</option>
                      {syncGeoEntities.map(en => (
                        <option key={en.entity_code} value={en.entity_code}>{en.legal_name} ({en.entity_code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="hg-modal__field">
                    <label className="hg-modal__label">Property Name *</label>
                    <input className="nv-input" value={syncPropertyName}
                      onChange={e => setSyncPropertyName(e.target.value)} />
                  </div>
                  <div className="hg-modal__field">
                    <label className="hg-modal__label">Market *</label>
                    <select className="nv-input" value={syncMarket} onChange={e => setSyncMarket(e.target.value)}>
                      <option value="">Select…</option>
                      {syncMarkets.map(m => (
                        <option key={m.market} value={m.market}>{m.label} ({m.market})</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {syncError && <div className="wizard-error">{syncError}</div>}
            </div>

            <div className="hg-modal__footer">
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--md"
                onClick={() => setSyncOpen(false)}>
                Skip for now
              </button>
              <button type="button" className="nv-btn nv-btn--solid nv-btn--md"
                disabled={syncSaving}
                onClick={submitSync}>
                {syncSaving ? 'Saving…' : 'Create & Link'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  The Nuvho legal entity responsible for this group&apos;s contracts and billing.
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
                <label className="hg-modal__label">Market *</label>
                <select className="nv-input" value={hgAddMarket} onChange={e => setHgAddMarket(e.target.value)}>
                  <option value="">Select…</option>
                  {hgAddMarkets.map(m => (
                    <option key={m.market} value={m.market}>{m.label} ({m.market})</option>
                  ))}
                </select>
                <p className="hg-modal__hint">
                  A property record (and pid) is created under this group immediately, using this market.
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
                  New groups start as <strong>Prospect</strong>. Move to <strong>Onboarding</strong> once you&apos;ve engaged the client.
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
        .hs-section {
          padding: 14px 16px; border: 1.5px solid var(--nv-border); border-radius: var(--nv-radius-md);
        }
        .hs-section__label {
          font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--nv-text-muted); margin-bottom: 8px;
        }
        .hs-section__hint { margin: 8px 0 0; font-size: 12px; color: var(--nv-text-muted); line-height: 1.5; }
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
  { code: 'CR' as ServiceCode, name: 'Concierge Revenue',   desc: 'Upselling, packages, ancillary revenue' },
  { code: 'MK' as ServiceCode, name: 'Marketing',           desc: 'Digital marketing, content, campaigns' },
]

function Step2Services({ draft, setDraft, errors }: StepProps) {
  function toggle(code: ServiceCode) {
    setDraft(d => {
      if (d.services.some(s => s.code === code)) {
        return { ...d, services: d.services.filter(s => s.code !== code) }
      }
      // Pricing is configured entirely on the Pricing step now — seed the
      // monthlyFee/setupFee/term summary from the catalog's default fee rows
      // so totals are correct even if the user never edits a row there.
      const feeRows = initFeeRows(code)
      return {
        ...d,
        services: [...d.services, {
          code,
          ...deriveFeeSummary(feeRows),
          scopeItems: initScopeItems(code),
          feeRows,
          footnotes: initFootnotes(code),
        } as DraftServiceLine],
      }
    })
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
            </div>
          )
        })}
      </div>

      <p className="step-note">Pricing for each selected service is configured on the next Pricing step.</p>

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
        .step-note {
          margin-top: 16px;
          font-size: 12px;
          color: var(--nv-text-muted);
          font-style: italic;
        }
      `}</style>
    </div>
  )
}

/* ─── Service tab bar — shown when more than one service line is selected ─── */
/* ─── Step 3: Scope ───
   Mirrors the Pricing step: no tabs — every selected service's scope of work
   renders sequentially on the same page, each preceded by a coloured service
   header (only shown when more than one service is selected, since there's
   nothing to distinguish with just one) and ending in its own
   "+ Add Custom Item" control scoped to that service. */
function Step3Scope({ draft, setDraft }: StepProps) {
  const services = draft.services

  function updateScopeItems(code: ServiceCode, scopeItems: ScopeItem[]) {
    setDraft(d => ({
      ...d,
      services: d.services.map(s => s.code === code ? { ...s, scopeItems } : s),
    }))
  }

  if (services.length === 0) {
    return (
      <div className="step-content">
        <h2 className="step-title">Scope of Work</h2>
        <p className="step-desc">Select at least one service in the previous step to define its scope.</p>
      </div>
    )
  }

  const showGroupLabels = services.length > 1

  return (
    <div className="step-content">
      <h2 className="step-title">Scope of Work</h2>
      <p className="step-desc">
        Drag rows to reorder, click text to edit, uncheck to exclude an item from this proposal.
      </p>
      {services.map(s => (
        <ScopeServiceGroup
          key={s.code}
          label={SERVICE_CATALOG[s.code].label}
          color={SERVICE_CATALOG[s.code].color}
          showLabel={showGroupLabels}
          scopeItems={s.scopeItems}
          onChange={items => updateScopeItems(s.code, items)}
        />
      ))}
    </div>
  )
}

function ScopeServiceGroup({ label, color, showLabel, scopeItems, onChange }: {
  label: string; color: string; showLabel: boolean
  scopeItems: ScopeItem[]; onChange: (items: ScopeItem[]) => void
}) {
  const dragIdx  = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function toggleItem(id: string) {
    onChange(scopeItems.map(it => it.id === id ? { ...it, enabled: !it.enabled } : it))
  }
  function editText(id: string, text: string) {
    onChange(scopeItems.map(it => it.id === id ? { ...it, text } : it))
  }
  function removeItem(id: string) {
    onChange(scopeItems.filter(it => it.id !== id))
  }
  function addCustom() {
    const newId = generateRowId('custom')
    onChange([...scopeItems, { id: newId, sectionHeading: 'Additional Items', text: '', enabled: true, isCustom: true }])
    setTimeout(() => setEditingId(newId), 50)
  }
  function onDragEnd() {
    if (dragIdx.current === null || dragOver.current === null || dragIdx.current === dragOver.current) {
      dragIdx.current = null; dragOver.current = null; return
    }
    const updated = [...scopeItems]
    const [moved] = updated.splice(dragIdx.current, 1)
    updated.splice(dragOver.current, 0, moved)
    dragIdx.current = null; dragOver.current = null
    onChange(updated)
  }

  let lastSection: string | null = null

  return (
    <div className="scope-group">
      {showLabel && <div className="scope-group-label" style={{ background: color }}>{label}</div>}
      {scopeItems.map((item, i) => {
        const showHeading = item.sectionHeading !== lastSection
        lastSection = item.sectionHeading
        const isEditing = editingId === item.id
        return (
          <div key={item.id}>
            {showHeading && (
              <div className="scope-heading" style={{ color, marginTop: i > 0 ? 16 : 0 }}>
                {item.sectionHeading}
              </div>
            )}
            <div
              className={`scope-row ${item.enabled ? 'scope-row--on' : 'scope-row--off'}`}
              draggable
              onDragStart={() => { dragIdx.current = i }}
              onDragEnter={() => { dragOver.current = i }}
              onDragEnd={onDragEnd}
              onDragOver={e => e.preventDefault()}
            >
              <span className="scope-row__handle">⠿</span>
              <button type="button" className={`nv-checkbox ${item.enabled ? 'nv-checkbox--checked' : ''}`}
                onClick={() => toggleItem(item.id)} aria-label="Toggle item">
                {item.enabled && '✓'}
              </button>
              <div className="scope-row__text" onClick={() => !isEditing && setEditingId(item.id)}>
                {isEditing ? (
                  <textarea autoFocus className="nv-input scope-row__textarea"
                    value={item.text}
                    onChange={e => editText(item.id, e.target.value)}
                    onBlur={() => setEditingId(null)} />
                ) : (
                  <span className={item.enabled ? '' : 'scope-row__text--disabled'}>
                    {item.text || 'Enter scope item text…'}
                  </span>
                )}
              </div>
              <div className="scope-row__actions">
                <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm"
                  onClick={() => setEditingId(isEditing ? null : item.id)}>Edit</button>
                {item.isCustom && (
                  <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm scope-row__remove"
                    onClick={() => removeItem(item.id)}>Remove</button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm scope-add" onClick={addCustom}>
        + Add Custom Item
      </button>

      <style jsx>{`
        .scope-group { display: flex; flex-direction: column; margin-bottom: 28px; }
        .scope-group:last-child { margin-bottom: 0; }
        .scope-group-label {
          padding: 6px 12px; margin-bottom: 12px; border-radius: 6px; color: white;
          font-size: 11px; font-weight: 700; font-family: var(--font-comfortaa);
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .scope-heading {
          font-size: 11px; font-weight: 700; font-family: var(--font-comfortaa);
          margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1.5px solid var(--nv-border-hair);
        }
        .scope-row {
          display: flex; gap: 8px; align-items: flex-start; padding: 7px 10px; margin-bottom: 6px;
          border-radius: 8px; cursor: grab; border: 1px solid var(--nv-border-hair);
        }
        .scope-row--on  { background: rgba(40,104,127,0.04); }
        .scope-row--off { background: var(--nv-platinum); }
        .scope-row__handle { color: var(--nv-text-muted); flex-shrink: 0; }
        .scope-row__text { flex: 1; font-size: 12px; line-height: 1.6; cursor: text; }
        .scope-row__text--disabled { color: var(--nv-text-muted); }
        .scope-row__textarea { min-height: 52px; font-size: 12px; padding: 5px 8px; }
        .scope-row__actions { display: flex; gap: 2px; flex-shrink: 0; }
        .scope-row__remove { color: var(--nv-error); }
        .scope-add { margin-top: 10px; }
        .nv-checkbox {
          width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--nv-border);
          background: transparent; cursor: pointer; flex-shrink: 0; margin-top: 2px;
          display: flex; align-items: center; justify-content: center; font-size: 11px; color: white;
        }
        .nv-checkbox--checked { border-color: var(--nv-blue-slate); background: var(--nv-blue-slate); }
      `}</style>
    </div>
  )
}

/* ─── Step 4: Pricing ───
   All selected services' pricing now renders in one continuous table on this
   page — no per-service tabs. Each service appears as a coloured group-label
   divider (only shown when more than one service is selected) followed by its
   fee rows, in the same order services were selected on Step 2. Footnotes are
   likewise stacked sequentially beneath the table rather than tab-switched. */
function Step4Pricing({ draft, setDraft }: StepProps) {
  const services = draft.services

  function updateService(code: ServiceCode, feeRows: FeeRow[], footnotes: PricingFootnote[]) {
    const summary = deriveFeeSummary(feeRows)
    setDraft(d => ({
      ...d,
      services: d.services.map(s => s.code === code
        ? { ...s, feeRows, footnotes, ...summary }
        : s),
    }))
  }

  if (services.length === 0) {
    return (
      <div className="step-content">
        <h2 className="step-title">Pricing</h2>
        <p className="step-desc">Select at least one service in the previous step to configure pricing.</p>
      </div>
    )
  }

  const grandTotal = services.reduce((sum, s) => sum + deriveFeeSummary(s.feeRows).monthlyFee, 0)
  const showGroupLabels = services.length > 1

  return (
    <div className="step-content">
      <h2 className="step-title">Pricing</h2>
      <p className="step-desc">Drag to reorder · add or remove rows · all fields fully editable.</p>

      <div className="pricing-table">
        <div className="pricing-row pricing-row--header">
          <span />
          <span>Component</span>
          <span>Fee Type</span>
          <span>Amount</span>
          <span>Months</span>
          <span>Note</span>
          <span />
        </div>
        {services.map(s => (
          <PricingServiceGroup
            key={s.code}
            label={SERVICE_CATALOG[s.code].label}
            color={SERVICE_CATALOG[s.code].color}
            showLabel={showGroupLabels}
            feeRows={s.feeRows}
            onChange={feeRows => updateService(s.code, feeRows, s.footnotes)}
          />
        ))}
      </div>

      <div className="pricing-footer">
        {grandTotal > 0 && (
          <div className="pricing-total">Combined monthly total: ${grandTotal.toLocaleString()}</div>
        )}
      </div>

      <div className="footnotes-box">
        <div className="footnotes-box__header">
          <span>Small Print / Footnotes</span>
        </div>
        {services.map(s => (
          <FootnotesGroup
            key={s.code}
            label={showGroupLabels ? SERVICE_CATALOG[s.code].label : undefined}
            footnotes={s.footnotes}
            onChange={footnotes => updateService(s.code, s.feeRows, footnotes)}
          />
        ))}
      </div>

      <style jsx>{`
        .pricing-table { border-radius: 8px; overflow: hidden; border: 1px solid var(--nv-border-hair); }
        .pricing-row--header {
          display: grid; grid-template-columns: 20px 1.4fr 1fr 0.8fr 0.6fr 1.2fr 20px;
          gap: 6px; padding: 7px 10px; align-items: center;
          background: var(--nv-blue-slate); color: white; font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.06em; cursor: default;
        }
        .pricing-footer { display: flex; align-items: center; justify-content: flex-end; margin-top: 10px; }
        .pricing-total { font-size: 12px; font-weight: 700; color: var(--nv-blue-slate); }
        .footnotes-box { margin-top: 18px; padding: 14px 16px; background: var(--nv-platinum); border-radius: 10px; }
        .footnotes-box__header { margin-bottom: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--nv-text-muted); }
      `}</style>
    </div>
  )
}

/* One service's slice of the shared pricing table: an optional coloured group
   label (hidden when only one service is selected, since there's nothing to
   distinguish it from) followed by its editable, drag-reorderable fee rows. */
function PricingServiceGroup({ label, color, showLabel, feeRows, onChange }: {
  label: string; color: string; showLabel: boolean
  feeRows: FeeRow[]; onChange: (feeRows: FeeRow[]) => void
}) {
  const dragIdx  = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)

  function update(id: string, field: keyof FeeRow, val: string | number) {
    onChange(feeRows.map(r => r.id === id ? { ...r, [field]: val } : r))
  }
  function addRow() {
    onChange([...feeRows, { id: generateRowId('fee'), component: '', feeType: 'monthly' as FeeType, fee: '', term: '', note: '' }])
  }
  function removeRow(id: string) {
    onChange(feeRows.filter(r => r.id !== id))
  }
  function onDragEnd() {
    if (dragIdx.current === null || dragOver.current === null || dragIdx.current === dragOver.current) {
      dragIdx.current = null; dragOver.current = null; return
    }
    const updated = [...feeRows]
    const [moved] = updated.splice(dragIdx.current, 1)
    updated.splice(dragOver.current, 0, moved)
    dragIdx.current = null; dragOver.current = null
    onChange(updated)
  }

  return (
    <>
      {showLabel && <div className="pricing-group-label" style={{ background: color }}>{label}</div>}
      {feeRows.map((row, i) => (
        <div key={row.id} className="pricing-row"
          draggable
          onDragStart={() => { dragIdx.current = i }}
          onDragEnter={() => { dragOver.current = i }}
          onDragEnd={onDragEnd}
          onDragOver={e => e.preventDefault()}
        >
          <span className="pricing-row__handle">⠿</span>
          <input className="nv-input nv-input--sm" placeholder="e.g. Monthly Retainer"
            value={row.component} onChange={e => update(row.id, 'component', e.target.value)} />
          <select className="nv-input nv-input--sm" value={row.feeType}
            onChange={e => update(row.id, 'feeType', e.target.value as FeeType)}>
            {FEE_TYPES.map(ft => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
          </select>
          <input className="nv-input nv-input--sm" type="number" placeholder="0.00"
            value={row.fee} onChange={e => update(row.id, 'fee', e.target.value === '' ? '' : +e.target.value)} />
          <input className="nv-input nv-input--sm" type="number" placeholder="—"
            value={row.term} onChange={e => update(row.id, 'term', e.target.value === '' ? '' : +e.target.value)} />
          <input className="nv-input nv-input--sm" placeholder="Optional note…"
            value={row.note} onChange={e => update(row.id, 'note', e.target.value)} />
          <button type="button" className="pricing-row__remove" onClick={() => removeRow(row.id)}>×</button>
        </div>
      ))}
      <div className="pricing-row-add">
        <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" onClick={addRow}>+ Add Row</button>
      </div>

      <style jsx>{`
        .pricing-row {
          display: grid; grid-template-columns: 20px 1.4fr 1fr 0.8fr 0.6fr 1.2fr 20px;
          gap: 6px; padding: 7px 10px; align-items: center; background: white;
          border-bottom: 1px solid var(--nv-border-hair); cursor: grab;
        }
        .pricing-row-add { display: flex; justify-content: flex-end; padding: 8px 10px; }
        .pricing-row__handle { color: var(--nv-text-muted); }
        .pricing-row__remove { background: none; border: none; cursor: pointer; color: var(--nv-error); font-size: 16px; line-height: 1; }
        .pricing-group-label {
          padding: 6px 12px; color: white; font-size: 11px; font-weight: 700;
          font-family: var(--font-comfortaa); text-transform: uppercase; letter-spacing: 0.05em;
        }
        .nv-input--sm { padding: 6px 8px; font-size: 12px; }
      `}</style>
    </>
  )
}

/* One service's footnotes, stacked beneath the shared table (labelled only
   when more than one service is present) instead of living behind a tab. */
function FootnotesGroup({ label, footnotes, onChange }: {
  label?: string; footnotes: PricingFootnote[]; onChange: (footnotes: PricingFootnote[]) => void
}) {
  function addFootnote() {
    onChange([...footnotes, { id: generateRowId('fn'), text: '' }])
  }
  function updateFootnote(id: string, text: string) {
    onChange(footnotes.map(f => f.id === id ? { ...f, text } : f))
  }
  function removeFootnote(id: string) {
    onChange(footnotes.filter(f => f.id !== id))
  }

  return (
    <div className="footnotes-group">
      <div className="footnotes-group__header">
        {label && <span className="footnotes-group__label">{label}</span>}
        <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={addFootnote}>+ Add Line</button>
      </div>
      {footnotes.length === 0 && <div className="footnotes-box__empty">No footnotes — click &quot;Add Line&quot; to add small print.</div>}
      {footnotes.map(fn => (
        <div key={fn.id} className="footnote-row">
          <input className="nv-input nv-input--sm" value={fn.text}
            placeholder="e.g. Our fees exclude advertising costs and out-of-pocket expenses."
            onChange={e => updateFootnote(fn.id, e.target.value)} />
          <button type="button" className="footnote-row__remove" onClick={() => removeFootnote(fn.id)}>×</button>
        </div>
      ))}

      <style jsx>{`
        .footnotes-group { margin-bottom: 14px; }
        .footnotes-group:last-child { margin-bottom: 0; }
        .footnotes-group__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
        .footnotes-group__label { font-size: 11px; font-weight: 700; color: var(--nv-text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .footnotes-box__empty { font-size: 11px; color: var(--nv-text-muted); font-style: italic; margin-bottom: 6px; }
        .footnote-row { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
        .footnote-row :global(input) { flex: 1; }
        .footnote-row__remove { background: none; border: none; cursor: pointer; color: var(--nv-error); font-size: 16px; line-height: 1; }
        .nv-input--sm { padding: 6px 8px; font-size: 12px; }
      `}</style>
    </div>
  )
}

/* ─── Step 5: Sender ─── */
function Step5Sender({ draft, setDraft, errors, staff = [], staffLoading, staffError }: StepProps) {
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

        <FormField label="Account Manager" error={errors.accountManagerId} span={2}>
          <select className="nv-input"
            disabled={staffLoading}
            value={draft.sender.accountManagerId}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, accountManagerId: e.target.value } }))}>
            <option value="">
              {staffLoading ? 'Loading Microsoft 365 users…' : 'Select account manager…'}
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

/* ─── Step 6: Cover Image ─── */
function Step6Cover({ draft, setDraft, errors }: StepProps) {
  const COVER_OPTIONS = [
    { url: '/covers/sunset-pier.jpg',   label: 'Sunset Pier'  },
    { url: '/covers/winter-pier.jpg',   label: 'Winter Pier'  },
    { url: '/covers/resort-pool.jpg',   label: 'Resort Pool'  },
    { url: '/covers/city-skyline.jpg',  label: 'City Skyline' },
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
            <div className="cover-option__img" style={{ backgroundImage: `url(${opt.url})` }} />
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
          background-color: var(--nv-platinum);
          background-size: cover;
          background-position: center;
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

/* ─── Step 7: Terms & Conditions ─── */
function Step7Terms({ draft, setDraft, errors }: StepProps) {
  const terms = draft.terms
  const region = draft.hotel.region
  const govLaw = REGION_META[region].govLaw

  function updateTerms(next: Partial<typeof terms>) {
    setDraft(d => ({ ...d, terms: { ...d.terms, ...next } }))
  }
  function updateClauses(clauses: TermsClause[]) {
    setDraft(d => ({ ...d, terms: { ...d.terms, clauses } }))
  }
  function addClause() {
    updateClauses([...terms.clauses, { id: generateRowId('term'), heading: 'New Clause', text: '', enabled: true }])
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Terms &amp; Conditions</h2>
      <p className="step-desc">
        Standard clauses seeded from Nuvho&apos;s template — drag to reorder, click to edit, uncheck to exclude.
      </p>

      <div className="form-grid">
        <FormField label="Proposal Validity" error={errors.validityDays}>
          <input className="nv-input" type="number"
            value={terms.validityDays}
            onChange={e => updateTerms({ validityDays: +e.target.value })} />
        </FormField>
        <FormField label="Governing Region">
          <input className="nv-input" value={govLaw} readOnly disabled />
        </FormField>
      </div>

      <TermsEditor clauses={terms.clauses} onChange={updateClauses} />
      <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm terms-add-clause" onClick={addClause}>
        + Add Clause
      </button>

      <div className="signature-box">
        <label className="signature-box__toggle">
          <button type="button" className={`nv-checkbox ${terms.signatureRequired ? 'nv-checkbox--checked' : ''}`}
            onClick={() => updateTerms({ signatureRequired: !terms.signatureRequired })}>
            {terms.signatureRequired && '✓'}
          </button>
          <span>Require e-signature block on the client-facing proposal</span>
        </label>

        {terms.signatureRequired && (
          <>
            <div className="signature-method" role="tablist" aria-label="Signature method">
              <button type="button" role="tab" aria-selected={terms.signatureMethod === 'type'}
                className={`signature-method__btn ${terms.signatureMethod === 'type' ? 'signature-method__btn--active' : ''}`}
                onClick={() => updateTerms({ signatureMethod: 'type' })}>
                Type name
              </button>
              <button type="button" role="tab" aria-selected={terms.signatureMethod === 'draw'}
                className={`signature-method__btn ${terms.signatureMethod === 'draw' ? 'signature-method__btn--active' : ''}`}
                onClick={() => updateTerms({ signatureMethod: 'draw' })}>
                Draw signature
              </button>
            </div>

            <div className="form-grid" style={{ marginTop: 14 }}>
              <FormField label="Signatory Name"
                error={terms.signatureMethod === 'type' ? errors.signatoryName : undefined}>
                <input className="nv-input" placeholder="e.g. Jane Smith"
                  value={terms.signatoryName} onChange={e => updateTerms({ signatoryName: e.target.value })} />
              </FormField>
              <FormField label="Signatory Title">
                <input className="nv-input" placeholder="e.g. General Manager"
                  value={terms.signatoryTitle} onChange={e => updateTerms({ signatoryTitle: e.target.value })} />
              </FormField>
            </div>

            {terms.signatureMethod === 'type' ? (
              <div className="signature-preview">
                <span className="signature-preview__label">Signature preview</span>
                <div className="signature-preview__script">
                  {terms.signatoryName || 'Your name here'}
                </div>
              </div>
            ) : (
              <div className="signature-preview">
                <span className="signature-preview__label">Draw signature</span>
                {errors.signatureDataUrl && (
                  <div style={{ color: 'var(--nv-error)', fontSize: 12, marginBottom: 6 }}>{errors.signatureDataUrl}</div>
                )}
                <SignaturePad
                  value={terms.signatureDataUrl}
                  onChange={dataUrl => updateTerms({ signatureDataUrl: dataUrl })}
                />
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .terms-add-clause { margin-top: 4px; margin-bottom: 20px; }
        .signature-box { padding: 16px; background: var(--nv-platinum); border-radius: 10px; }
        .signature-box__toggle { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 12px; font-weight: 600; }
        .nv-checkbox {
          width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--nv-border);
          background: transparent; cursor: pointer; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center; font-size: 11px; color: white;
        }
        .nv-checkbox--checked { border-color: var(--nv-blue-slate); background: var(--nv-blue-slate); }

        .signature-method { display: flex; gap: 8px; margin-top: 14px; }
        .signature-method__btn {
          padding: 7px 16px; border-radius: 20px; border: 2px solid var(--nv-border);
          background: white; color: var(--nv-text-body); font-size: 12px; font-weight: 600;
          font-family: var(--font-comfortaa); cursor: pointer;
        }
        .signature-method__btn--active { border-color: var(--nv-blue-slate); background: var(--nv-blue-slate); color: white; }

        .signature-preview { margin-top: 14px; }
        .signature-preview__label {
          display: block; font-size: 11px; font-weight: 700; color: var(--nv-text-muted);
          text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px;
        }
        .signature-preview__script {
          font-family: var(--font-signature);
          font-size: 40px;
          line-height: 1.3;
          color: var(--nv-text-heading);
          padding: 6px 14px 10px;
          border-bottom: 1.5px solid var(--nv-border);
          max-width: 420px;
        }
      `}</style>
    </div>
  )
}

/* Hand-drawn signature capture — a plain <canvas> (no drawing library needed)
   using pointer events so it works with mouse, pen, and touch alike. Restores
   a previously-saved PNG data URL on mount so re-visiting this step (or
   re-opening a saved draft) doesn't wipe out the signature. */
function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const inkedRef   = useRef(!!value)

  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !value) return
    const img = new Image()
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    img.src = value
    // Restore-on-mount only — deliberately not re-run on every `value` change,
    // since strokes already update `value` via onChange as the user draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    ctx.strokeStyle = '#28687F'
    ctx.lineWidth   = 2.25
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    const { x, y } = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    inkedRef.current = true
  }

  function end() {
    if (!drawingRef.current) return
    drawingRef.current = false
    const canvas = canvasRef.current
    if (canvas && inkedRef.current) onChange(canvas.toDataURL('image/png'))
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    inkedRef.current = false
    onChange('')
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={420}
        height={140}
        className="signature-pad__canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="signature-pad__footer">
        <span className="signature-pad__hint">Draw with your mouse, pen, or finger</span>
        <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={clear}>Clear</button>
      </div>

      <style jsx>{`
        .signature-pad__canvas {
          display: block; width: 100%; max-width: 420px; height: 140px;
          background: white; border: 1.5px dashed var(--nv-border);
          border-radius: 8px; cursor: crosshair; touch-action: none;
        }
        .signature-pad__footer {
          display: flex; align-items: center; justify-content: space-between;
          margin-top: 6px; max-width: 420px;
        }
        .signature-pad__hint { font-size: 11px; color: var(--nv-text-muted); font-style: italic; }
      `}</style>
    </div>
  )
}

function TermsEditor({ clauses, onChange }: { clauses: TermsClause[]; onChange: (clauses: TermsClause[]) => void }) {
  const dragIdx  = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function update(id: string, field: keyof TermsClause, val: string | boolean) {
    onChange(clauses.map(c => c.id === id ? { ...c, [field]: val } : c))
  }
  function remove(id: string) {
    onChange(clauses.filter(c => c.id !== id))
  }
  function onDragEnd() {
    if (dragIdx.current === null || dragOver.current === null || dragIdx.current === dragOver.current) {
      dragIdx.current = null; dragOver.current = null; return
    }
    const updated = [...clauses]
    const [moved] = updated.splice(dragIdx.current, 1)
    updated.splice(dragOver.current, 0, moved)
    dragIdx.current = null; dragOver.current = null
    onChange(updated)
  }

  return (
    <div className="clause-list">
      {clauses.map((clause, i) => {
        const isEditing = editingId === clause.id
        return (
          <div key={clause.id}
            className={`clause-row ${clause.enabled ? 'clause-row--on' : 'clause-row--off'}`}
            draggable
            onDragStart={() => { dragIdx.current = i }}
            onDragEnter={() => { dragOver.current = i }}
            onDragEnd={onDragEnd}
            onDragOver={e => e.preventDefault()}
          >
            <span className="clause-row__handle">⠿</span>
            <button type="button" className={`nv-checkbox ${clause.enabled ? 'nv-checkbox--checked' : ''}`}
              onClick={() => update(clause.id, 'enabled', !clause.enabled)}>
              {clause.enabled && '✓'}
            </button>
            <div className="clause-row__body" onClick={() => !isEditing && setEditingId(clause.id)}>
              {isEditing ? (
                <>
                  <input className="nv-input clause-row__heading-input"
                    value={clause.heading} onChange={e => update(clause.id, 'heading', e.target.value)} />
                  <textarea autoFocus className="nv-input clause-row__text-input"
                    value={clause.text}
                    onChange={e => update(clause.id, 'text', e.target.value)}
                    onBlur={() => setEditingId(null)} />
                </>
              ) : (
                <>
                  <div className="clause-row__heading">{clause.heading || 'Clause heading…'}</div>
                  <div className="clause-row__text">{clause.text || 'Enter clause text…'}</div>
                </>
              )}
            </div>
            <div className="clause-row__actions">
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm"
                onClick={() => setEditingId(isEditing ? null : clause.id)}>Edit</button>
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm clause-row__remove"
                onClick={() => remove(clause.id)}>Remove</button>
            </div>
          </div>
        )
      })}

      <style jsx>{`
        .clause-list { display: flex; flex-direction: column; margin-bottom: 8px; }
        .clause-row {
          display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; margin-bottom: 8px;
          border-radius: 8px; cursor: grab; border: 1px solid var(--nv-border-hair);
        }
        .clause-row--on  { background: rgba(40,104,127,0.04); }
        .clause-row--off { background: var(--nv-platinum); }
        .clause-row__handle { color: var(--nv-text-muted); flex-shrink: 0; margin-top: 2px; }
        .clause-row__body { flex: 1; cursor: text; }
        .clause-row__heading { font-size: 12px; font-weight: 700; font-family: var(--font-comfortaa); margin-bottom: 3px; color: var(--nv-blue-slate); }
        .clause-row__text { font-size: 12px; line-height: 1.6; }
        .clause-row__heading-input { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
        .clause-row__text-input { font-size: 12px; min-height: 60px; }
        .clause-row__actions { display: flex; gap: 2px; flex-shrink: 0; }
        .clause-row__remove { color: var(--nv-error); }
        .nv-checkbox {
          width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--nv-border);
          background: transparent; cursor: pointer; flex-shrink: 0; margin-top: 2px;
          display: flex; align-items: center; justify-content: center; font-size: 11px; color: white;
        }
        .nv-checkbox--checked { border-color: var(--nv-blue-slate); background: var(--nv-blue-slate); }
      `}</style>
    </div>
  )
}

/* ─── Step 8: Preview & Send ─── */
function Step8Preview({ draft, setDraft, errors, staff = [] }: StepProps) {
  const total = draft.services.reduce((acc, s) => acc + s.monthlyFee * s.term + s.setupFee, 0)
  const model = buildDocModelFromDraft(draft, staff)
  const [exporting, setExporting] = useState<'pdf' | 'word' | null>(null)

  const handleDownloadPdf = () => {
    setExporting('pdf')
    // Print-to-PDF: @media print (globals.css) hides everything except
    // #proposal-print-root, which <ProposalDocument> renders into.
    window.setTimeout(() => window.print(), 50)
    window.setTimeout(() => setExporting(null), 600)
  }

  const handleDownloadWord = async () => {
    setExporting('word')
    try {
      const blob = await buildDocxFile(model)
      downloadBlob(blob, `${model.title.replace(/[^\w-]+/g, '-')}.docx`)
    } finally {
      setExporting(null)
    }
  }

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
        <SummaryRow label="Terms validity" value={`${draft.terms.validityDays} days`} />
        <SummaryRow label="Signature" value={
          !draft.terms.signatureRequired
            ? 'Not required'
            : draft.terms.signatureMethod === 'draw'
              ? (draft.terms.signatureDataUrl ? 'Drawn signature captured' : 'Required')
              : (draft.terms.signatoryName || 'Required')
        } />
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

      <div className="preview-doc-header">
        <div>
          <h3 className="preview-doc-heading">Document Preview</h3>
          <p className="step-desc">This is the structure the generated proposal document will follow.</p>
        </div>
        <div className="preview-doc-actions">
          <button type="button" className="nv-btn nv-btn--ghost" onClick={handleDownloadPdf} disabled={exporting !== null}>
            {exporting === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button type="button" className="nv-btn nv-btn--ghost" onClick={handleDownloadWord} disabled={exporting !== null}>
            {exporting === 'word' ? 'Preparing…' : 'Download Word'}
          </button>
        </div>
      </div>
      <ProposalDocument model={model} />

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
        .preview-doc-header {
          margin-top: 28px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
        }
        .preview-doc-heading {
          font-family: var(--font-comfortaa);
          font-size: 15px;
          color: var(--nv-text-heading);
        }
        .preview-doc-actions { display: flex; gap: 10px; flex-shrink: 0; }
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
  if (draft.step === 5 && !draft.sender.staffId) {
    errs.staffId = 'Please select a sender'
  }
  if (draft.step === 7 && draft.terms.signatureRequired) {
    if (draft.terms.signatureMethod === 'draw') {
      if (!draft.terms.signatureDataUrl) {
        errs.signatureDataUrl = 'Please draw a signature, or switch to "Type name"'
      }
    } else if (!draft.terms.signatoryName.trim()) {
      errs.signatoryName = 'Signatory name is required when a signature block is requested'
    }
  }
  return errs
}
