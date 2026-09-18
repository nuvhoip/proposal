'use client'

import React, { useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type {
  ProposalDraft, ServiceCode, Region, DraftServiceLine, ScopeItem, FeeRow,
  PricingFootnote, TermsClause, FeeType, RegionSettings, ServiceCategory,
} from '@/lib/types'
import {
  getServiceLabel, getServiceColor, FEE_TYPES, REGION_META, initScopeItems, initFeeRows,
  initFootnotes, initTerms, generateRowId, deriveFeeSummary,
} from '@/lib/serviceCatalog'
import { buildDocModelFromDraft, parseCoverUrl, buildCoverUrl, buildDefaultIntroMessage } from '@/lib/documentModel'
import dynamic from 'next/dynamic'

// The page editor uses native browser selection and editable A4 sheets.
const A4DocumentEditor = dynamic(
  () => import('@/components/proposal/A4DocumentEditor').then(m => m.A4DocumentEditor),
  { ssr: false, loading: () => <p className="step-desc">Loading page editor…</p> },
)
import type { A4Document } from '@/lib/a4Document'
import { RichTextEditor } from '@/components/proposal/RichTextEditor'
import { setNavigationGuard } from '@/lib/navigationGuard'
import { useSession } from '@/components/auth/AuthGuard'

// NUVCL-118: the Sender step (staff picker + AI email-message composer +
// attachments) was removed — the platform is scoped to PDF/DOC generation
// only for now, not the send/e-signature workflow. Sender still auto-defaults
// to the signed-in staff member (see the useEffect on draft.sender.staffId
// below, from NUVCL-88); Account Manager moved into Step 1 (Hotel Details)
// since it's a real client-relationship field, not a send-workflow field.
// The Signature step was later removed too, for the same reason — see the
// comment above Step7Preview below.
const STEPS = [
  { id: 1, label: 'Hotel Details'  },
  { id: 2, label: 'Services'       },
  { id: 3, label: 'Scope'          },
  { id: 4, label: 'Pricing'        },
  { id: 5, label: 'Cover Image'    },
  { id: 6, label: 'Terms'          },
  { id: 7, label: 'Preview & Save' },
]

// Steps that offer a "Skip" control beside Continue — Services/Scope/Pricing
// detail and the Terms & Conditions review are all optional for proposals
// that don't need them; Skip advances without running that step's validation.
const SKIPPABLE_STEPS = [2, 3, 4, 6]

const EMPTY_DRAFT: ProposalDraft = {
  step: 1,
  hotel: {
    name: '', region: 'au', hgid: '', pid: '', entityCode: '', contactName: '', contactEmail: '',
    contactPhone: '', contactTitle: '', propertyAddress: '',
    hubspotDealId: '', hubspotCompanyId: '', hubspotContactId: '',
  },
  regionSettings: { address: '', companyName: '', aboutNuvho: '', footerText: '', currency: REGION_META.au.currency },
  services:     [],
  sender:       { staffId: '', accountManagerId: '', message: '' },
  cover:        { coverUrl: '' },
  terms:        initTerms('au'),
  preview:      { recipientEmail: '' },
}

export default function NewProposalPage() {
  const [documentReady, setDocumentReady] = useState(false)
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
  const session = useSession()

  // NUVCL-118: attachment upload (and the Sender step it lived under) was
  // removed from the wizard — the platform is scoped to PDF/DOC generation
  // only for now. proposal_attachments/the attachment endpoints still exist
  // on the worker untouched; there's just no wizard UI feeding them anymore.

  // Unsaved-changes guard — lets AppShell warn before navigating away from
  // an in-progress wizard (new or edit). baselineRef captures the draft's
  // "saved" shape once — after the initial region-settings apply for a
  // brand-new proposal, or once an existing proposal has finished loading
  // for edit mode — and every render is compared against it. draftRef
  // mirrors the latest draft so the guard function (registered once) always
  // reads current state without re-registering on every keystroke. See
  // lib/navigationGuard.ts.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const baselineRef = useRef<string | null>(null)

  // Region Settings (Settings → Region Settings) — Nuvho address, company
  // name, about text, legal footer, currency, and default T&Cs clauses per
  // region, applied onto the draft whenever a region is selected. Lives here
  // (not inside Step1HotelDetails) so an in-flight fetch/apply isn't dropped
  // by that step component unmounting when the wizard advances past step 1.
  // Fetched once and cached; falls back to the serviceCatalog defaults
  // (REGION_META/defaultTermsClauses) if the request hasn't resolved yet or
  // fails, so the wizard still behaves sensibly offline/on error.
  const [regionSettingsMap, setRegionSettingsMap] = useState<Record<Region, RegionSettings> | null>(null)
  const appliedInitialRegionSettings = useRef(false)
  // Captures the Governing Entity the proposal was saved/loaded with,
  // so the entity-driven regionSettings/clauses effect below can tell
  // "just finished loading an existing proposal" (leave its saved
  // snapshot alone) apart from "the user deliberately changed the
  // Governing Entity during this edit session" (recompute). Set once
  // the edit-mode load resolves (or stays null for a brand-new
  // proposal, where the guard below never applies).
  const initialGoverningEntityCodeRef = useRef<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/regions`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok || cancelled) return
        const map = {} as Record<Region, RegionSettings>
        for (const r of (data.data as RegionSettings[])) map[r.region] = r
        setRegionSettingsMap(map)
      } catch { /* fall back to serviceCatalog defaults silently */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Service Categories (Settings → Service Lines) — the main service-line
  // options Step 2 offers. Fetched once here (not inside Step2Services)
  // so it survives that step's component unmounting when the wizard
  // advances, same reasoning as regionSettingsMap above. Only active
  // categories are shown to select from; a category deleted or deactivated
  // after a proposal already used its code doesn't affect that proposal —
  // getServiceLabel/getServiceColor fall back gracefully for unknown codes.
  const [serviceCategories, setServiceCategories] = useState<ServiceCategory[]>([])
  const [serviceCategoriesLoading, setServiceCategoriesLoading] = useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/service-categories`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok || cancelled) return
        const active = (data.data as ServiceCategory[])
          .filter(c => c.active)
          .sort((a, b) => a.sortOrder - b.sortOrder)
        setServiceCategories(active)
      } catch { /* Step2Services shows an error state if this never resolves */ }
      finally { if (!cancelled) setServiceCategoriesLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Legal entities (Nuvho Master Registry, same data Settings → Entities
  // lists) — used by Step 7's Governing Entity picker. Fetched once here
  // (not inside Step6Terms) for the same reason as regionSettingsMap/
  // serviceCategories above: the step component unmounts on every step
  // change, which would otherwise drop an in-flight fetch. Same
  // /registry/entities endpoint the Step 1 "Add Hotel Group"/"Sync to
  // Registry" flows already call further down this file.
  const [entities, setEntities]               = useState<RegistryEntity[]>([])
  const [entitiesLoading, setEntitiesLoading] = useState(true)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/entities`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok || cancelled) return
        setEntities(data.data?.entities || [])
      } catch { /* Step6Terms just shows an empty/loading select if this never resolves */ }
      finally { if (!cancelled) setEntitiesLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Default Step 7's Governing Entity to the contracting entity chosen on
  // Step 1 (draft.hotel.entityCode) once it's known — the two usually are
  // the same entity, so this saves a redundant manual pick. Only fires
  // while governingEntityCode is still unset, so it never clobbers a
  // manual override on Step 7, or a value already loaded from a saved
  // proposal in edit mode (the editId effect above sets both at once).
  React.useEffect(() => {
    if (!draft.hotel.entityCode || draft.terms.governingEntityCode) return
    setDraft(d => d.terms.governingEntityCode ? d : {
      ...d, terms: { ...d.terms, governingEntityCode: d.hotel.entityCode },
    })
  }, [draft.hotel.entityCode, draft.terms.governingEntityCode])

  // Entity Settings (Settings → Entities) — each entity's own Terms &
  // Conditions clauses (entity_settings.clauses_json), merged in by the
  // worker's getEntitySettings(). Keyed by entity_code so the effect below
  // can pull the Governing Entity's own clauses instead of a generic
  // regional fallback. Fetched once here for the same "don't drop an
  // in-flight fetch when a step unmounts" reason as entities/
  // regionSettingsMap above.
  const [entitySettingsMap, setEntitySettingsMap] = useState<Record<string, {
    clauses: TermsClause[]; address: string; companyName: string
    aboutNuvho: string; footerText: string; currency: string
  }> | null>(null)

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/settings/entities`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok || cancelled) return
        const map: Record<string, {
          clauses: TermsClause[]; address: string; companyName: string
          aboutNuvho: string; footerText: string; currency: string
        }> = {}
        for (const e of (data.data as {
          entityCode: string; legalName: string; clauses: TermsClause[]
          address: string; aboutNuvho: string; footerText: string; currency: string
        }[])) {
          map[e.entityCode] = {
            clauses:     e.clauses || [],
            address:     e.address || '',
            companyName: e.legalName || '',
            aboutNuvho:  e.aboutNuvho || '',
            footerText:  e.footerText || '',
            currency:    e.currency || '',
          }
        }
        setEntitySettingsMap(map)
      } catch { /* the effect below falls back to an empty clause list / blank fields */ }
    })()
    return () => { cancelled = true }
  }, [])

  // Entity-specific document content — address/company name/about-us/
  // footer/currency AND Terms & Conditions clauses all come from whichever
  // Governing Entity is selected (Settings → Entities), not from a
  // region-wide default. Previously only clauses were entity-driven here;
  // address/companyName/aboutNuvho/footerText were still keyed by REGION
  // (applyRegionSettings, further below) via a fixed per-region "operating"
  // entity code, so they silently kept showing the wrong entity's
  // letterhead whenever the Governing Entity was changed a second time
  // after an initial pick (the auto-default effect above only sets
  // governingEntityCode once, while it's still unset) — reported by
  // Odysseus 2026-09-17: picking "Nuvho Ltd - UK" still showed the AU
  // entity's address/footer/T&Cs. Runs for brand-new proposals always; in
  // edit mode it's held back until the Governing Entity actually changes
  // from what the proposal was saved with, so simply opening an existing
  // proposal for editing never silently rewrites its saved snapshot — only
  // a deliberate entity change does. When no Governing Entity has resolved
  // yet, clauses are blanked (an unresolved entity means an empty
  // Appendix, not a generic filler set) but regionSettings is left alone so
  // the Step 1 default population isn't clobbered before a pick is made.
  React.useEffect(() => {
    if (editId && draft.terms.governingEntityCode === initialGoverningEntityCodeRef.current) return
    if (!entitySettingsMap) return
    const code = draft.terms.governingEntityCode
    const settings = code ? entitySettingsMap[code] : undefined
    setDraft(d => ({
      ...d,
      regionSettings: code ? {
        address:     settings?.address     ?? '',
        companyName: settings?.companyName ?? '',
        aboutNuvho:  settings?.aboutNuvho  ?? '',
        footerText:  settings?.footerText  ?? '',
        currency:    settings?.currency    || REGION_META[d.hotel.region].currency,
      } : d.regionSettings,
      terms: {
        ...d.terms,
        clauses: (settings?.clauses ?? []).map(c => ({
          id: generateRowId('term'), heading: c.heading, text: c.text,
          enabled: (c as Partial<TermsClause>).enabled ?? true,
        })),
      },
    }))
  }, [draft.terms.governingEntityCode, entitySettingsMap, editId])

  function applyRegionSettings(region: Region) {
    const rs = regionSettingsMap?.[region]
    const address     = rs?.address     ?? ''
    const companyName = rs?.companyName ?? ''
    const aboutNuvho  = rs?.aboutNuvho  ?? ''
    const footerText  = rs?.footerText  ?? ''
    const currency    = rs?.currency    ?? REGION_META[region].currency
    // Clauses are no longer applied from here — they're entity-specific now
    // (see the entitySettingsMap effect above), not region-specific.
    setDraft(d => ({ ...d, regionSettings: { address, companyName, aboutNuvho, footerText, currency } }))
  }

  // Apply once for the default region on a brand-new proposal only — editing
  // an existing proposal already loads its saved regionSettings/terms
  // snapshot (the editId effect above) and must not have that overwritten by
  // fresh Region Settings defaults. No longer gated on Step1HotelDetails
  // being mounted, so it fires as soon as the fetch resolves regardless of
  // which step the user has since navigated to.
  React.useEffect(() => {
    if (editId) return
    if (!regionSettingsMap) return
    if (appliedInitialRegionSettings.current) return
    appliedInitialRegionSettings.current = true
    applyRegionSettings(draft.hotel.region)
    // Deliberately only depends on regionSettingsMap/editId — the ref guard
    // above ensures this fires once for a brand-new proposal's *initial*
    // region default; including applyRegionSettings/draft.hotel.region would
    // make it re-fire on every later region change, which is already
    // handled directly by Step1HotelDetails's own onChange handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionSettingsMap, editId])

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
        initialGoverningEntityCodeRef.current = (p.terms && p.terms.governingEntityCode) || p.entity_code || null
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
          // Snapshot captured when this proposal was created/last saved —
          // preserved as-is here rather than re-derived from current Region
          // Settings, so an old proposal doesn't silently pick up an address/
          // footer/currency change made in Settings after the fact.
          regionSettings: {
            address:     p.nuvho_address || '',
            companyName: p.company_name || '',
            aboutNuvho:  p.about_nuvho || '',
            footerText:  p.footer_text || '',
            currency:    p.currency || REGION_META[(p.region || 'au') as Region].currency,
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

  // NUVCL-88: default "Sending on behalf of" to the currently signed-in
  // user on a brand-new proposal (never on an edit-existing load, which
  // sets sender.staffId from the saved proposal a few lines up). Guarded
  // on the current value being empty so it only fires once and doesn't
  // clobber a manual change made afterwards.
  React.useEffect(() => {
    if (editId || !session?.staffId) return
    setDraft(d => d.sender.staffId ? d : { ...d, sender: { ...d.sender, staffId: session.staffId! } })
  }, [editId, session])

  // Pre-fill Step 1's "Personal message" editor with a real, editable
  // starting paragraph for a brand-new proposal, so staff see actual text
  // instead of an empty field that only relies on documentModel.ts's
  // invisible build-time fallback (buildDefaultIntroMessage — same text).
  // Service/hotel name aren't chosen yet this early in the wizard, so this
  // uses literal `[service]`/`[Property Name]` placeholders for staff to fill
  // in. Never runs on an edit-mode load, and only while the field is still
  // at its initial empty state, so it doesn't clobber a manual edit made
  // afterwards — same guard as the staffId effect above.
  React.useEffect(() => {
    if (editId) return
    setDraft(d => d.sender.message ? d : ({
      ...d,
      sender: { ...d.sender, message: buildDefaultIntroMessage('[service]', d.hotel.name || '[Property Name]') },
    }))
  }, [editId])

  // NUVCL-117: pre-fill Step 7's Signature fields from the signed-in user's
  // saved Settings signature (Settings → User Settings), for new proposals
  // only — never overriding an edit-mode load (matches the sender.staffId
  // effect above). Only fills in when the fields are still at their initial
  // empty state, so it never clobbers a manual change made afterwards, and
  // always leaves signatureRequired/method fully overridable per proposal.
  React.useEffect(() => {
    if (editId || !session?.staffId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/staff/me/signature`, { credentials: 'include' })
        const data = await res.json()
        if (!res.ok || cancelled) return
        const { signatoryName, signatureMethod, signatureDataUrl } = data.data || {}
        if (!signatureMethod) return   // nothing saved in Settings yet
        setDraft(d => (d.terms.signatoryName || d.terms.signatureDataUrl) ? d : {
          ...d,
          terms: {
            ...d.terms,
            signatureMethod:  signatureMethod,
            signatoryName:    signatoryName || '',
            signatureDataUrl: signatureMethod === 'draw' ? (signatureDataUrl || '') : d.terms.signatureDataUrl,
          },
        })
      } catch {
        // Best-effort pre-fill only — Step 7 still works via manual entry if this fails.
      }
    })()
    return () => { cancelled = true }
  }, [editId, session])

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

  // Capture the dirty-check baseline once the draft has settled into its
  // "just loaded" shape — for a new proposal that's right after the default
  // Region Settings/T&Cs have been applied; for an edit that's right after
  // the existing proposal finishes loading. Guarded by the null-check so it
  // only ever fires once per mount. If regionSettingsMap never resolves
  // (e.g. offline), the baseline is simply never set and the guard reports
  // "no unsaved changes" rather than blocking navigation indefinitely.
  React.useEffect(() => {
    if (baselineRef.current !== null) return
    const ready = editId ? !loadingExisting : appliedInitialRegionSettings.current
    if (ready) baselineRef.current = JSON.stringify(draft)
  }, [draft, loadingExisting, editId])

  // Register the guard AppShell checks before following a sidebar/menu
  // click, and warn on an actual tab close/refresh too. Registered once on
  // mount (not per-keystroke) — the closure reads draftRef/baselineRef so it
  // always sees current values.
  React.useEffect(() => {
    function isDirty() {
      return baselineRef.current !== null && JSON.stringify(draftRef.current) !== baselineRef.current
    }
    setNavigationGuard(isDirty)
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      setNavigationGuard(null)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
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
  // Advances a step without running validateStep — used by the Skip control
  // on steps where filling in that step's content is optional (see
  // SKIPPABLE_STEPS). Deliberately does not clear/reset the step's own data.
  function goSkip() {
    setErrors({})
    setDraft(d => ({ ...d, step: Math.min(STEPS.length, d.step + 1) }))
  }

  // If staff picked "Upload custom image" on the Cover Image step,
  // draft.cover.coverUrl currently holds a browser-local `blob:` URL (set
  // for immediate preview only — see Step5Cover's file input below) and
  // draft.cover.uploadFile holds the actual File. Neither the Proposal
  // Details page nor the public Accept & Sign page can resolve a blob: URL
  // outside this tab, so it needs to become a real, durable URL before the
  // proposal is saved. Returns the resolved coverUrl to save (unchanged if
  // no new file was picked), or throws on upload failure.
  async function resolveCoverUrlForSave(proposalId: string): Promise<string> {
    if (!draft.cover.uploadFile) return draft.cover.coverUrl
    const form = new FormData()
    form.append('file', draft.cover.uploadFile)
    const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${proposalId}/cover-photo`, {
      method: 'POST', credentials: 'include', body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to upload cover photo')
    const durableUrl = `${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${proposalId}/cover-photo`
    const { template } = parseCoverUrl(draft.cover.coverUrl)
    return template ? buildCoverUrl(template, durableUrl) : durableUrl
  }

  async function createDraftProposal(): Promise<string> {
    let id: string
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
          nuvho_address:    draft.regionSettings.address,
          company_name:     draft.regionSettings.companyName,
          about_nuvho:      draft.regionSettings.aboutNuvho,
          footer_text:      draft.regionSettings.footerText,
          currency:         draft.regionSettings.currency,
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
      id = editId
    } else {
      // uploadFile is a local-only File reference (see resolveCoverUrlForSave
      // above) — never actually sent to the API; the real upload happens
      // below once this call has returned an id to upload against.
      const { uploadFile, ...coverForApi } = draft.cover
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...draft, cover: coverForApi }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create proposal')
      id = data.data.id as string
    }

    // See resolveCoverUrlForSave above — a freshly-picked cover photo only
    // has a browser-local blob: URL until now; upload it and patch cover_url
    // to the durable URL the worker hands back, now that this proposal has
    // an id to upload against. Deliberately caught locally rather than left
    // to propagate: the proposal record itself was already saved by the
    // create/update call above, so a cover-photo failure (upload endpoint
    // not yet deployed, a transient network/R2 hiccup, an oversized file)
    // must not make the WHOLE save look like it failed — that previously
    // aborted createDraftProposal entirely and left the proposal record
    // saved but reported to staff as "not saving".
    if (draft.cover.uploadFile) {
      try {
        const durableCoverUrl = await resolveCoverUrlForSave(id)
        const patchRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/proposals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ cover_url: durableCoverUrl }),
        })
        const patchData = await patchRes.json()
        if (!patchRes.ok) throw new Error(patchData.error || 'Failed to save cover photo')
      } catch (e: any) {
        console.error('[Cover photo] upload failed:', e)
        setErrors(prev => ({
          ...prev,
          submit: `Proposal saved, but the cover photo failed to upload (${e?.message || 'unknown error'}) — reopen this proposal and re-upload it from the Cover Image step.`,
        }))
      }
    }

    return id
  }

  // NUVCL-118: attachment upload lived under the now-removed Sender step.
  // The worker's /proposals/:id/attachments endpoints and proposal_attachments
  // table are untouched — just no wizard UI feeds them anymore.

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

  // Per request: this step no longer sends — it only generates/saves the
  // proposal. Sending now happens exclusively from the proposal's detail
  // page (its Send button always confirms before sending, per NUVCL-99).
  async function handleSubmit() {
    setSaving(true)
    try {
      const id = await createDraftProposal()
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
    <div className={`wizard-page${step === 7 ? " wizard-page--preview" : ""}`}>
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
            <Step1HotelDetails draft={draft} setDraft={setDraft} errors={errors} editId={editId}
              applyRegionSettings={applyRegionSettings}
              entities={entities} entitiesLoading={entitiesLoading}
              staff={staff} staffLoading={staffLoading} staffError={staffError} />
          )}
          {step === 2 && (
            <Step2Services draft={draft} setDraft={setDraft} errors={errors}
              serviceCategories={serviceCategories} serviceCategoriesLoading={serviceCategoriesLoading} />
          )}
          {step === 3 && (
            <Step3Scope draft={draft} setDraft={setDraft} errors={errors} serviceCategories={serviceCategories} />
          )}
          {step === 4 && (
            <Step4Pricing draft={draft} setDraft={setDraft} errors={errors} serviceCategories={serviceCategories} />
          )}
          {step === 5 && (
            <Step5Cover draft={draft} setDraft={setDraft} errors={errors} />
          )}
          {step === 6 && (
            <Step6Terms draft={draft} setDraft={setDraft} errors={errors}
              entities={entities} entitiesLoading={entitiesLoading} />
          )}
          {step === 7 && (
            <Step7Preview draft={draft} setDraft={setDraft} errors={errors} staff={staff} onDocumentReady={setDocumentReady} />
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
              ? <div style={{ display: 'flex', gap: 12 }}>
                  {SKIPPABLE_STEPS.includes(step) && (
                    <button className="nv-btn nv-btn--outlined nv-btn--md" onClick={goSkip}>
                      Skip
                    </button>
                  )}
                  <button className="nv-btn nv-btn--solid nv-btn--md" onClick={goNext}>
                    Continue →
                  </button>
                </div>
              : <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    className="nv-btn nv-btn--outlined nv-btn--md"
                    onClick={handleSaveDraft}
                    disabled={saving || savingDraft || !documentReady}
                    aria-busy={savingDraft}
                  >
                    {savingDraft ? 'Saving…' : 'Save as Draft'}
                  </button>
                  <button
                    className="nv-btn nv-btn--solid nv-btn--md"
                    onClick={handleSubmit}
                    disabled={saving || savingDraft || !documentReady}
                    aria-busy={saving}
                  >
                    {saving ? 'Saving…' : 'Save Document'}
                  </button>
                </div>}
          </div>
        </div>
      </div>

      <style jsx>{`
        .wizard-page { padding: 32px 40px; max-width: 900px; }
        .wizard-page--preview { max-width: 1440px; }
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

// Hides the Step 1 "Confidential" toggle per request, without deleting the
// (already cosmetic-only, unwired) feature — flip back to true to restore it.
const SHOW_CONFIDENTIAL_TOGGLE = false

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

// NUVCL-97: Step 1's Governing Entity picker sets draft.hotel.region from
// the chosen entity's jurisdiction, using the same prefix-matching
// convention as REGION_JURISDICTION_PREFIX above (registry.entity_codes.
// jurisdiction is free text like "Australia (QLD)", not a 2-letter code).
// Returns null — rather than guessing — if a future entity's jurisdiction
// doesn't match any of the three known prefixes.
function regionFromJurisdiction(jurisdiction: string): Region | null {
  const j = jurisdiction.trim().toLowerCase()
  for (const region of Object.keys(REGION_JURISDICTION_PREFIX) as Region[]) {
    if (j.startsWith(REGION_JURISDICTION_PREFIX[region])) return region
  }
  return null
}

// NUVCL-121 (2026-08-24): MARKETS_BY_GEO removed — the Master Registry
// dropped the market component entirely, so the wizard no longer needs a
// market picker anywhere in the Hotel Details flow.

// NUVCL-122 (2026-08-24): Odysseus's decision — pause hotel-group/property
// *creation* from the wizard for now (Jude's Property-selector ask is
// deferred). Flip to true to re-enable the "Add Hotel Group" entry point;
// the underlying code (openAddHotelGroup/submitAddHotelGroup, the registry
// create routes) is left fully intact, just unreachable from the UI.
const ENABLE_HOTEL_GROUP_CREATION = false

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

// NUVCL-121 (2026-08-24): RegistryMarket interface removed along with the
// market picker it typed.

// Combined search result — the unified box below queries the Master
// Registry and HubSpot in parallel and shows both, tagged by source.
// Reconciliation between the two systems happens after a pick (keyed by
// hgid/pid/hubspot_id), not by fuzzy-matching names across the two lists.
type CombinedResult =
  | { source: 'registry'; hg: RegistryHotelGroupSummary }
  | { source: 'hubspot';  hs: HubspotSearchResult }

function Step1HotelDetails({
  draft, setDraft, errors, editId, applyRegionSettings, entities = [], entitiesLoading,
  staff = [], staffLoading, staffError,
}: StepProps) {
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

  // NUVCL-122: Property (PRP) selector sourced from the Master Registry,
  // replacing the free-text Property name field once a hotel group (hgid) is
  // linked. Property *creation* stays paused (ENABLE_HOTEL_GROUP_CREATION,
  // above) — this only lets staff pick among a group's existing registry
  // properties, mirroring the same auto-select-when-one-result pattern
  // already used for the sync modal below.
  const [hgProperties, setHgProperties]           = useState<RegistryPropertySummary[]>([])
  const [hgPropertiesLoading, setHgPropertiesLoading] = useState(false)
  const [hgPropertiesError, setHgPropertiesError] = useState('')
  // Popped up instead of a free-text fallback when a linked hotel group has
  // zero properties in the Master Registry — per Odysseus, 2026-08-24,
  // staff should be redirected to add the property there rather than typing
  // a name locally (property creation from this wizard stays paused).
  const [noPropertyModalOpen, setNoPropertyModalOpen] = useState(false)

  function fetchHgProperties(hgid: string) {
    let cancelled = false
    setHgPropertiesLoading(true)
    setHgPropertiesError('')
    fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/${hgid}/properties`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const props: RegistryPropertySummary[] = data?.data?.properties || []
        setHgProperties(props)
        if (props.length === 1 && !h.pid) {
          setDraft(d => ({ ...d, hotel: { ...d.hotel, pid: props[0].pid, name: props[0].property_name } }))
        }
        setNoPropertyModalOpen(props.length === 0)
      })
      .catch(() => { if (!cancelled) setHgPropertiesError('Could not load properties for this hotel group.') })
      .finally(() => { if (!cancelled) setHgPropertiesLoading(false) })
    return () => { cancelled = true }
  }

  React.useEffect(() => {
    if (!h.hgid) { setHgProperties([]); setHgPropertiesError(''); setNoPropertyModalOpen(false); return }
    return fetchHgProperties(h.hgid)
  }, [h.hgid])

  function selectHgProperty(pid: string) {
    const p = hgProperties.find(pr => pr.pid === pid)
    if (!p) return
    setDraft(d => ({ ...d, hotel: { ...d.hotel, pid: p.pid, name: p.property_name } }))
  }

  // "Confidential" toggle at the top of Hotel Details — cosmetic only for
  // now, per request: just the check mark, not yet wired to the draft, the
  // API, or the generated document.
  const [confidential, setConfidential] = useState(false)

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
            // NUVCL-128 (regression fix, 2nd time): geo (physical country,
            // e.g. GR for Greece) is NOT the same thing as Region (Nuvho's
            // own au/uk/ie operating jurisdiction) — filtering the typeahead
            // by the wizard's Region field permanently hid any hotel group
            // whose geo isn't literally "AU"/"UK"/"IE" (e.g. Vision Hotels,
            // geo=GR, Region=ie). The registry typeahead already scopes by
            // Governing Entity server-side; it doesn't need geo at all.
            `${process.env.NEXT_PUBLIC_WORKER_URL}/registry/hotel-groups/typeahead?${new URLSearchParams({ q: acctQuery.trim() })}`,
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
  }, [acctQuery, h.hgid])

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
  // NUVCL-121: syncMarket/syncMarkets removed — market is no longer part of
  // property creation.
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
        // NUVCL-121: market list fetch removed — no longer part of property creation.
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
    setSyncError('')
    setSyncOpen(true)
  }

  // Opened when a HubSpot company is picked with no hgid property set yet.
  function openSyncToRegistry(companyId: string, name: string) {
    setSyncDirection('toRegistry')
    setSyncCompanyId(companyId)
    setSyncCompanyName(name)
    setSyncPropertyName(name)
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
          const propRes = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/registry/properties`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hgid: syncHgid, entity_code: h.entityCode, property_name: syncPropertyName.trim(),
              geo: h.region.toUpperCase(),
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
            geo: h.region.toUpperCase(),
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
          // Do NOT default this to the Hotel Group's own name — this field is
          // the PROPOSAL'S PROPERTY NAME (proposal.hotel_name), which the Teams
          // automation uses verbatim as the per-property sub-channel's display
          // name. Auto-filling it here let people click through the wizard
          // without ever typing the actual property name, so the property
          // sub-channel ended up named identically to the Hotel-Group channel.
          // Leaving it blank forces the existing "Property name is required"
          // validation to do its job. Fixed 2026-09-18, confirmed with Odysseus.
          name: d.hotel.name,
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
    // name: d.hotel.name (not r.name) — see the 2026-09-18 fix note above; this
    // field is the property name, not the HubSpot Company (Hotel Group) name.
    setDraft(d => ({ ...d, hotel: { ...d.hotel, name: d.hotel.name, hubspotCompanyId: r.id, pid: r.pid || d.hotel.pid } }))
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

  // NUVCL-123: HubSpot Deal search/link/create — mirrors the unified
  // hotel-group/account search box above, scoped to /hubspot/deals*.
  const [dealQuery, setDealQuery]     = useState(h.hubspotDealName || '')
  const [dealOpen, setDealOpen]       = useState(false)
  const [dealLoading, setDealLoading] = useState(false)
  const [dealResults, setDealResults] = useState<{ id: string; name: string; amount: string | null; stage: string | null }[]>([])
  const [dealCreating, setDealCreating] = useState(false)
  const [dealError, setDealError]     = useState('')

  React.useEffect(() => {
    if (h.hubspotDealId || dealQuery.trim().length < 2) { setDealResults([]); return }
    let cancelled = false
    const timer = setTimeout(async () => {
      setDealLoading(true)
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_WORKER_URL}/hubspot/deals/search?${new URLSearchParams({ q: dealQuery.trim() })}`,
          { credentials: 'include' }
        ).then(r => r.json())
        if (!cancelled) setDealResults(res?.data?.results || [])
      } catch {
        if (!cancelled) setDealResults([])
      } finally {
        if (!cancelled) setDealLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [dealQuery, h.hubspotDealId])

  function selectDeal(d: { id: string; name: string }) {
    setDraft(dd => ({ ...dd, hotel: { ...dd.hotel, hubspotDealId: d.id, hubspotDealName: d.name } }))
    setDealQuery(d.name)
    setDealOpen(false)
  }

  function clearDeal() {
    setDraft(dd => ({ ...dd, hotel: { ...dd.hotel, hubspotDealId: '', hubspotDealName: '' } }))
    setDealQuery('')
  }

  async function createDeal() {
    if (!dealQuery.trim()) return
    setDealCreating(true)
    setDealError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/hubspot/deals`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealName: dealQuery.trim(),
          companyId: h.hubspotCompanyId || undefined,
          contactId: h.hubspotContactId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.success === false) {
        throw new Error(data.error?.message || data.error || 'Could not create the HubSpot deal.')
      }
      const { dealId } = data.data || {}
      setDraft(dd => ({ ...dd, hotel: { ...dd.hotel, hubspotDealId: dealId, hubspotDealName: dealQuery.trim() } }))
      setDealOpen(false)
    } catch (e) {
      setDealError(e instanceof Error ? e.message : 'Could not create the HubSpot deal.')
    } finally {
      setDealCreating(false)
    }
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
  // NUVCL-121: Active/Inactive per the registry's hotel_groups.is_active
  // field — separate from the prospect/onboarding lifecycle status above.
  const [hgAddIsActive, setHgAddIsActive] = useState(true)
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

  // NUVCL-121 (2026-08-24): hgAddMarket/hgAddMarkets removed — market is no
  // longer part of hotel-group/property creation.

  function openAddHotelGroup() {
    setHgAddGroupName(acctQuery.trim())
    setHgAddTradingName('')
    setHgAddGeo(h.region)
    setHgAddStatus('prospect')
    setHgAddIsActive(true)
    setHgAddError('')
    setHgAddOpen(true)
    setAcctOpen(false)
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
          is_active: hgAddIsActive,
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
          geo: hgAddGeo.toUpperCase(),
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
          // Do NOT default this to the Hotel Group's own name — this field is
          // the PROPOSAL'S PROPERTY NAME (proposal.hotel_name), which the Teams
          // automation uses verbatim as the per-property sub-channel's display
          // name. Auto-filling it here let people click through the wizard
          // without ever typing the actual property name, so the property
          // sub-channel ended up named identically to the Hotel-Group channel.
          // Leaving it blank forces the existing "Property name is required"
          // validation to do its job. Fixed 2026-09-18, confirmed with Odysseus.
          name: d.hotel.name,
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
      <div className="step-header-row">
        <div>
          <h2 className="step-title">Hotel Details</h2>
          <p className="step-desc">Enter the hotel and primary contact information.</p>
        </div>
        {SHOW_CONFIDENTIAL_TOGGLE && (
          <button
            type="button"
            className={`confidential-toggle ${confidential ? 'confidential-toggle--active' : ''}`}
            onClick={() => setConfidential(c => !c)}
            aria-pressed={confidential}
          >
            <span className="confidential-toggle__check">
              {confidential && (
                <svg width="9" height="9" viewBox="0 0 448 512" fill="white">
                  {/* nuvho-brand icon: check (duotone-thin) — same mark used by the
                      step indicator's completed-step state above */}
                  <path d="M444.7 65.5c3.6 2.6 4.3 7.6 1.7 11.2l-288 392c-1.4 1.9-3.5 3.1-5.8 3.2s-4.6-.7-6.3-2.3l-144-144c-3.1-3.1-3.1-8.2 0-11.3s8.2-3.1 11.3 0L151.1 451.8 433.6 67.3c2.6-3.6 7.6-4.3 11.2-1.7z"/>
                </svg>
              )}
            </span>
            Confidential
          </button>
        )}
      </div>

      {/* Governing Entity comes first — the account search below is scoped
          to its derived region. NUVCL-97: replaces the old plain AU/UK/IE
          Region picker with the same Master Registry legal-entity list
          Step 7's Governing Entity field already uses (entities/
          entitiesLoading, fetched once in the parent NewProposalPage), so
          Step 1 sets the real contracting Nuvho entity up front instead of
          just a country — region/currency/market/jurisdiction downstream
          are then derived from that entity rather than picked separately. */}
      <div className="form-grid">
        <FormField label="Governing Entity *" error={errors.region} span={2}>
          <select className="nv-input" value={h.entityCode}
            disabled={entitiesLoading}
            onChange={e => {
              const code = e.target.value
              const entity = entities.find(en => en.entity_code === code)
              // Fall back to the region already on the draft if this
              // entity's jurisdiction doesn't match a known prefix, rather
              // than silently defaulting to a wrong country.
              const region = (entity && regionFromJurisdiction(entity.jurisdiction)) || h.region
              // clearHotelGroup() resets entityCode to '' (a new governing
              // entity invalidates any previously-linked hotel group, same
              // as a region change used to) — it must run BEFORE we set the
              // just-picked entityCode/region, not after, since sequential
              // setDraft calls in this handler apply in order and a later
              // reset would otherwise wipe the entity the user just chose.
              clearHotelGroup()
              // Set governingEntityCode directly here too (not just
              // hotel.entityCode) so re-picking a different Governing
              // Entity always cascades to address/footer/about-us/T&Cs —
              // previously this relied solely on the auto-default effect,
              // which only fires once while governingEntityCode is still
              // unset, so changing your mind after an initial pick left
              // the OLD entity's document content in place.
              setDraft(d => ({
                ...d,
                hotel: { ...d.hotel, entityCode: code, region },
                terms: { ...d.terms, governingEntityCode: code },
              }))
            }}>
            <option value="">{entitiesLoading ? 'Loading entities…' : 'Select the contracting Nuvho entity…'}</option>
            {/* Shows every entity the registry returns (all 6 — holdco/
                IP-holdco/processor entities included), matching Step 7's
                Governing Entity picker exactly rather than narrowing to
                is_data_controller entities only. */}
            {entities.map(en => (
              <option key={en.entity_code} value={en.entity_code}>
                {en.legal_name} ({en.entity_code})
              </option>
            ))}
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
              {/* NUVCL-129 (regression fix, 2nd time): keep the ORIGINAL
                  Hotel Group Name once a property is picked — don't fall
                  back to it only when acctQuery is empty. acctQuery holds
                  whatever was typed/selected for the group itself, so it
                  must win over h.name (which selectHgProperty() does NOT
                  touch, but was still able to show through here before). */}
              {acctQuery || h.name} <code>{h.hgid}</code>{h.pid && <code>{h.pid}</code>}
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
                  <div className="hg-dropdown__item hg-dropdown__item--muted hg-dropdown__item--nomatch">
                    No matches for &quot;{acctQuery.trim()}&quot; in the registry or HubSpot.{' '}
                    <a href="https://register-admin.nuvho.com/" target="_blank" rel="noreferrer">
                      Add it to the Master Registry
                    </a>{' '}
                    and search again.
                  </div>
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
                {/* NUVCL-122 (2026-08-24): hotel-group creation paused for now —
                    button hidden, openAddHotelGroup/the modal below are untouched
                    so this is a one-line flip (ENABLE_HOTEL_GROUP_CREATION) to restore. */}
                {ENABLE_HOTEL_GROUP_CREATION && (
                  <button type="button" className="hg-dropdown__item hg-dropdown__item--add"
                    onMouseDown={e => e.preventDefault()}
                    onClick={openAddHotelGroup}>
                    + Add &quot;{acctQuery.trim()}&quot; as a new hotel group
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {errors.hgid || hgResolveError ? (
          <p className="hs-section__hint" style={{ color: 'var(--nv-error)' }}>{errors.hgid || hgResolveError}</p>
        ) : (
          <p className="hs-section__hint">
            Searches both the Nuvho Master Registry and HubSpot.
          </p>
        )}
      </div>

      <div className="form-grid">
        {/* NUVCL-122: once a hotel group is linked, Property name becomes a
            Property (PRP) picker sourced from the Master Registry instead of
            free text. Falls back to a plain text field when no hotel group
            is linked yet, or when the linked group has no registry
            properties (property creation from here is paused — see
            ENABLE_HOTEL_GROUP_CREATION above). */}
        <FormField label="Property name *" error={errors.hotelName || hgPropertiesError} span={2}>
          {!h.hgid ? (
            <input className="nv-input" placeholder="e.g. The Langham Sydney"
              value={h.name} onChange={e => update('name', e.target.value)} />
          ) : hgPropertiesLoading ? (
            <input className="nv-input" value="Loading properties…" disabled />
          ) : hgProperties.length > 0 ? (
            <select className="nv-input" value={h.pid} onChange={e => selectHgProperty(e.target.value)}>
              {!h.pid && <option value="">Select a property…</option>}
              {hgProperties.map(p => (
                <option key={p.pid} value={p.pid}>{p.property_name} ({p.pid})</option>
              ))}
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="nv-input" value="No property found in the Master Registry" disabled />
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm"
                onClick={() => setNoPropertyModalOpen(true)}>
                Details
              </button>
            </div>
          )}
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

        <FormField label="HubSpot Deal" error={errors.hubspotDealId || dealError} span={2}>
          {h.hubspotDealId ? (
            <div className="hg-selected">
              <span>{h.hubspotDealName || '(unnamed deal)'} <code>{h.hubspotDealId}</code></span>
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm" onClick={clearDeal}>
                Change
              </button>
            </div>
          ) : (
            <div className="hg-search">
              <input className="nv-input" placeholder="Search HubSpot deals… (optional)"
                value={dealQuery}
                onChange={e => { setDealQuery(e.target.value); setDealOpen(true) }}
                onFocus={() => setDealOpen(true)}
                onBlur={() => setTimeout(() => setDealOpen(false), 150)} />
              {dealOpen && dealQuery.trim().length >= 2 && (
                <div className="hg-dropdown">
                  {dealLoading && <div className="hg-dropdown__item hg-dropdown__item--muted">Searching…</div>}
                  {!dealLoading && dealResults.length === 0 && (
                    <div className="hg-dropdown__item hg-dropdown__item--muted">No matching deals.</div>
                  )}
                  {dealResults.map(d => (
                    <button type="button" key={d.id} className="hg-dropdown__item"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectDeal(d)}>
                      <strong>{d.name}</strong>
                      <span className="hg-dropdown__meta">{d.stage || '—'}{d.amount ? ` · ${d.amount}` : ''}</span>
                    </button>
                  ))}
                  <button type="button" className="hg-dropdown__item hg-dropdown__item--add"
                    onMouseDown={e => e.preventDefault()}
                    disabled={dealCreating}
                    onClick={createDeal}>
                    {dealCreating ? 'Creating…' : `+ Create "${dealQuery.trim()}" as a new deal`}
                  </button>
                </div>
              )}
            </div>
          )}
        </FormField>

        {/* NUVCL-118: moved here from the removed Sender step — Account
            Manager is a real client-relationship field, not part of the
            send workflow that step otherwise existed for. */}
        <FormField label="Account Manager" error={errors.accountManagerId}>
          <select className="nv-input"
            disabled={staffLoading}
            value={draft.sender.accountManagerId}
            onChange={e => setDraft(d => ({ ...d, sender: { ...d.sender, accountManagerId: e.target.value } }))}>
            <option value="">
              {staffLoading ? 'Loading Microsoft 365 users…' : 'Select account manager… (optional)'}
            </option>
            {staff.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.role_type}{s.m365_upn ? ` (${s.m365_upn})` : ''}
              </option>
            ))}
          </select>
          {staffError && <span style={{ color: 'var(--nv-error)', fontSize: 12 }}>{staffError}</span>}
        </FormField>

        {/* NUVCL-118: also moved here from the removed Sender step — this
            is the letter's opening paragraph (documentModel.ts's
            introMessage), not just an email body, so it stays even though
            the AI "Generate Email Template" button that used to sit next to
            it (a send-workflow feature) did not. */}
        <FormField label="Personal message (opening paragraph of the proposal letter)" span={2}>
          <RichTextEditor
            value={draft.sender.message}
            onChange={html => setDraft(d => ({ ...d, sender: { ...d.sender, message: html } }))}
            placeholder="Edit the default opening paragraph, or clear it and write a custom one — e.g. Hi Sarah, it was great speaking with you today…"
          />
        </FormField>
      </div>

      {/* No-properties-in-registry modal — pops up in place of a free-text
          fallback when the linked hotel group has zero properties in the
          Master Registry (property creation from this wizard stays paused;
          NUVCL-122, per Odysseus's 2026-08-24 follow-up). */}
      {noPropertyModalOpen && (
        <div className="hg-modal-overlay" onMouseDown={() => setNoPropertyModalOpen(false)}>
          <div className="hg-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="hg-modal__header">
              <h3>Property not in the Master Registry</h3>
              <button type="button" className="hg-modal__close" aria-label="Close"
                onClick={() => setNoPropertyModalOpen(false)}>
                ×
              </button>
            </div>
            <div className="hg-modal__body">
              <p className="hg-modal__hint">
                <strong>{acctQuery || 'This hotel group'}</strong> has no properties recorded in the Nuvho
                Master Registry yet. Add the property there first, then come back and search again — property
                creation from this wizard is currently paused.
              </p>
              {hgPropertiesError && <div className="wizard-error">{hgPropertiesError}</div>}
            </div>
            <div className="hg-modal__footer">
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--md"
                onClick={() => setNoPropertyModalOpen(false)}>
                Close
              </button>
              <button type="button" className="nv-btn nv-btn--solid nv-btn--md"
                disabled={hgPropertiesLoading}
                onClick={() => fetchHgProperties(h.hgid)}>
                {hgPropertiesLoading ? 'Checking…' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      <p className="hg-modal__hint">A new property (and pid) will be created under this hotel group.</p>
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
                <p className="hg-modal__hint">
                  A property record (and pid) is created under this group immediately.
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

              {/* NUVCL-121: Active/Inactive per the registry's hotel_groups.is_active field. */}
              <div className="hg-modal__field">
                <label className="hg-modal__label">Active</label>
                <select className="nv-input" value={hgAddIsActive ? 'active' : 'inactive'}
                  onChange={e => setHgAddIsActive(e.target.value === 'active')}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
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
        .hg-dropdown__item--nomatch { white-space: normal; line-height: 1.5; }
        .hg-dropdown__item--nomatch a { color: var(--nv-blue-slate); cursor: pointer; font-weight: 600; }
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

/* ─── Step 2: Services ───
   Options come from Settings → Service Lines (serviceCategories prop),
   not a hardcoded list, so admins can add/rename/reorder/retire service
   lines without a code change. See lib/serviceCatalog.ts's getServiceEntry
   for how codes without a hardcoded scope/pricing template (e.g. Systems,
   Advisory, or any custom category) start empty and are filled in manually
   on Steps 3–4. */
function Step2Services({ draft, setDraft, errors, serviceCategories = [], serviceCategoriesLoading }: StepProps) {
  function toggle(code: ServiceCode) {
    setDraft(d => {
      if (d.services.some(s => s.code === code)) {
        return { ...d, services: d.services.filter(s => s.code !== code) }
      }
      // Pricing is configured entirely on the Pricing step now — seed the
      // monthlyFee/setupFee/term summary from the catalog's default fee rows
      // so totals are correct even if the user never edits a row there.
      const feeRows = initFeeRows(code)
      // Prefer this category's live Settings → Service Lines default Scope of
      // Work (staff-editable) over the hardcoded SERVICE_CATALOG fallback —
      // initScopeItems() only falls back to the hardcoded sections when
      // liveScope is empty/undefined.
      const category = serviceCategories.find(c => c.code === code)
      return {
        ...d,
        services: [...d.services, {
          code,
          ...deriveFeeSummary(feeRows),
          scopeItems: initScopeItems(code, category?.defaultScope),
          feeRows,
          footnotes: initFootnotes(code, category?.defaultFootnotes),
        } as DraftServiceLine],
      }
    })
  }

  // NUVCL-106: a single tick box to select/deselect every service line at
  // once, instead of clicking each card individually. Reuses the same
  // seeding logic as toggle() (fee rows / scope items / footnotes) for any
  // category not already selected, and leaves already-selected lines'
  // configured pricing/scope untouched.
  const allSelected = serviceCategories.length > 0 &&
    serviceCategories.every(c => draft.services.some(s => s.code === c.code))

  function toggleAll() {
    setDraft(d => {
      if (allSelected) return { ...d, services: [] }
      const existingCodes = new Set(d.services.map(s => s.code))
      const additions = serviceCategories
        .filter(c => !existingCodes.has(c.code))
        .map(c => {
          const feeRows = initFeeRows(c.code)
          return {
            code: c.code,
            ...deriveFeeSummary(feeRows),
            scopeItems: initScopeItems(c.code, c.defaultScope),
            feeRows,
            footnotes: initFootnotes(c.code, c.defaultFootnotes),
          } as DraftServiceLine
        })
      return { ...d, services: [...d.services, ...additions] }
    })
  }

  return (
    <div className="step-content">
      <h2 className="step-title">Services</h2>
      <p className="step-desc">Select the services to include in this proposal and set pricing.</p>

      {errors.services && <div style={{color:'var(--nv-error)',fontSize:13,marginBottom:12}}>{errors.services}</div>}

      {serviceCategoriesLoading && <p className="step-note">Loading service lines…</p>}
      {!serviceCategoriesLoading && serviceCategories.length === 0 && (
        <p className="step-note">
          No service lines are configured yet — add some under Settings → Service Lines.
        </p>
      )}

      {!serviceCategoriesLoading && serviceCategories.length > 0 && (
        <label className="services-select-all">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all services
        </label>
      )}

      <div className="services-grid">
        {serviceCategories.map(svc => {
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
              <div className="service-card__name">{svc.label}</div>
              <div className="service-card__desc">{svc.description}</div>
            </div>
          )
        })}
      </div>

      <p className="step-note">Pricing for each selected service is configured on the next Pricing step.</p>

      <style jsx>{`
        .services-select-all {
          display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 600;
          color: var(--nv-text-muted); cursor: pointer; margin-top: 10px;
        }
        .services-select-all input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: var(--nv-blue-slate); }
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
function Step3Scope({ draft, setDraft, serviceCategories = [] }: StepProps) {
  const services = draft.services
  const categoryLabel = (code: ServiceCode) => serviceCategories.find(c => c.code === code)?.label

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
          label={getServiceLabel(s.code, categoryLabel(s.code))}
          color={getServiceColor(s.code)}
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

  // Requested follow-up: with a section like "Marketing" now split into many
  // headings (Strategic Marketing Planning, Social Media Management, etc. —
  // see Settings → Body Configuration), unchecking every item in a heading
  // one at a time was tedious. Each heading now gets its own select/deselect-
  // all checkbox, scoped to just the items sharing that sectionHeading —
  // same on/off toggling as an individual item's checkbox, just applied to
  // the whole group at once.
  function isSectionAllOn(heading: string): boolean {
    const items = scopeItems.filter(it => it.sectionHeading === heading)
    return items.length > 0 && items.every(it => it.enabled)
  }
  function toggleSection(heading: string) {
    const nextEnabled = !isSectionAllOn(heading)
    onChange(scopeItems.map(it => it.sectionHeading === heading ? { ...it, enabled: nextEnabled } : it))
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
                <label className="scope-heading__select-all">
                  <input type="checkbox"
                    checked={isSectionAllOn(item.sectionHeading)}
                    onChange={() => toggleSection(item.sectionHeading)} />
                  {item.sectionHeading}
                </label>
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
        .scope-heading__select-all {
          display: flex; align-items: center; gap: 7px; cursor: pointer;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .scope-heading__select-all input[type="checkbox"] {
          width: 13px; height: 13px; cursor: pointer; accent-color: var(--nv-blue-slate); flex-shrink: 0;
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
function Step4Pricing({ draft, setDraft, serviceCategories = [] }: StepProps) {
  const services = draft.services
  const categoryLabel = (code: ServiceCode) => serviceCategories.find(c => c.code === code)?.label

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
  const totalFootnotes = services.reduce((n, s) => n + s.footnotes.length, 0)

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
            label={getServiceLabel(s.code, categoryLabel(s.code))}
            color={getServiceColor(s.code)}
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
        {/* Requested follow-up: footnotes used to be split into a labelled
            "Marketing" / "Sales Management" etc. sub-group per service,
            mirroring the Scope/Pricing sections above — but footnotes are
            generic small print, not service-specific content, and the
            generated document already merges every service's footnotes into
            one unlabelled list (see documentModel.ts's
            `services.flatMap(s => s.footnotes)`). So the per-service label
            here was pure wizard-editor scaffolding with no equivalent in the
            output; removed so this editor matches what staff actually see
            on the document — one shared list, one Add button. Footnotes
            still save back onto their originating service under the hood
            (unchanged data model), they're just no longer visually split. */}
        {totalFootnotes === 0 && (
          <div className="footnotes-box__empty">No footnotes — click &quot;Add Custom Item&quot; to add small print.</div>
        )}
        {services.map((s, i) => (
          <FootnotesGroup
            key={s.code}
            footnotes={s.footnotes}
            onChange={footnotes => updateService(s.code, s.feeRows, footnotes)}
            showAddButton={i === services.length - 1}
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
        .footnotes-box { margin-top: 18px; }
        .footnotes-box__header { margin-bottom: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--nv-text-muted); }
        .footnotes-box__empty { font-size: 11px; color: var(--nv-text-muted); font-style: italic; margin-bottom: 6px; }
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

/* One service's slice of the shared, unlabelled footnotes list — see the
   comment above this component's call site in Step4Pricing for why there's
   no per-service label here even when several services are selected. */
function FootnotesGroup({ footnotes, onChange, showAddButton = true }: {
  footnotes: PricingFootnote[]; onChange: (footnotes: PricingFootnote[]) => void; showAddButton?: boolean
}) {
  const dragIdx  = useRef<number | null>(null)
  const dragOver = useRef<number | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  function addFootnote() {
    const newId = generateRowId('fn')
    onChange([...footnotes, { id: newId, text: '' }])
    setTimeout(() => setEditingId(newId), 50)
  }
  function updateFootnote(id: string, text: string) {
    onChange(footnotes.map(f => f.id === id ? { ...f, text } : f))
  }
  function removeFootnote(id: string) {
    onChange(footnotes.filter(f => f.id !== id))
  }
  function onDragEnd() {
    if (dragIdx.current === null || dragOver.current === null || dragIdx.current === dragOver.current) {
      dragIdx.current = null; dragOver.current = null; return
    }
    const updated = [...footnotes]
    const [moved] = updated.splice(dragIdx.current, 1)
    updated.splice(dragOver.current, 0, moved)
    dragIdx.current = null; dragOver.current = null
    onChange(updated)
  }

  return (
    <div className="footnotes-group">
      {footnotes.map((fn, i) => {
        const isEditing = editingId === fn.id
        return (
          <div key={fn.id} className="footnote-row"
            draggable
            onDragStart={() => { dragIdx.current = i }}
            onDragEnter={() => { dragOver.current = i }}
            onDragEnd={onDragEnd}
            onDragOver={e => e.preventDefault()}
          >
            <span className="footnote-row__handle">⠿</span>
            <span className="footnote-row__check" aria-hidden="true">✓</span>
            <div className="footnote-row__text" onClick={() => !isEditing && setEditingId(fn.id)}>
              {isEditing ? (
                <input autoFocus className="nv-input nv-input--sm footnote-row__input" value={fn.text}
                  placeholder="e.g. Our fees exclude advertising costs and out-of-pocket expenses."
                  onChange={e => updateFootnote(fn.id, e.target.value)}
                  onBlur={() => setEditingId(null)} />
              ) : (
                <span>{fn.text || 'Enter footnote text…'}</span>
              )}
            </div>
            <div className="footnote-row__actions">
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm"
                onClick={() => setEditingId(isEditing ? null : fn.id)}>Edit</button>
              <button type="button" className="nv-btn nv-btn--ghost nv-btn--sm footnote-row__remove"
                onClick={() => removeFootnote(fn.id)}>Remove</button>
            </div>
          </div>
        )
      })}

      {showAddButton && (
        <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm footnote-add" onClick={addFootnote}>
          + Add Custom Item
        </button>
      )}

      <style jsx>{`
        .footnotes-group { margin-bottom: 0; }
        .footnote-row {
          display: flex; gap: 8px; align-items: flex-start; padding: 7px 10px; margin-bottom: 6px;
          border-radius: 8px; cursor: grab; border: 1px solid var(--nv-border-hair); background: rgba(40,104,127,0.04);
        }
        .footnote-row__handle { color: var(--nv-text-muted); flex-shrink: 0; }
        .footnote-row__check {
          width: 18px; height: 18px; border-radius: 4px; border: 2px solid var(--nv-blue-slate);
          background: var(--nv-blue-slate); color: white; font-size: 11px; flex-shrink: 0; margin-top: 2px;
          display: flex; align-items: center; justify-content: center;
        }
        .footnote-row__text { flex: 1; font-size: 12px; line-height: 1.6; cursor: text; }
        .footnote-row__input { flex: 1; }
        .footnote-row__actions { display: flex; gap: 2px; flex-shrink: 0; }
        .footnote-row__remove { color: var(--nv-error); }
        .footnote-add { margin-top: 4px; }
        .nv-input--sm { padding: 6px 8px; font-size: 12px; }
      `}</style>
    </div>
  )
}

/* ─── Step 5: Cover Image ─── */
// NUVCL-119: four new branded A4 cover layouts, from Odysseus's "A4 cover
// page templates" design export. Stored as sentinel strings in the existing
// cover.coverUrl field (no schema change / migration needed — the worker
// already round-trips cover_url as an opaque TEXT column) so ProposalDocument
// can branch on a `branded:` prefix at render time; any other coverUrl value
// (a real image URL, or empty) falls through to the original photo-cover
// rendering untouched, so existing proposals are unaffected.
const BRANDED_COVER_TEMPLATES = [
  { id: 'branded:circles',   label: 'Teal — brand circles' },
  { id: 'branded:split',     label: 'Split panel'          },
]

function Step5Cover({ draft, setDraft, errors }: StepProps) {
  const COVER_OPTIONS = [
    { url: '/covers/sunset-pier.jpg',   label: 'Sunset Pier'  },
    { url: '/covers/winter-pier.jpg',   label: 'Winter Pier'  },
    { url: '/covers/resort-pool.jpg',   label: 'Resort Pool'  },
    { url: '/covers/city-skyline.jpg',  label: 'City Skyline' },
  ]
  const { template: selectedTemplate, photoUrl: selectedPhotoUrl } = parseCoverUrl(draft.cover.coverUrl)
  // "Teal — brand circles" is a photo-less layout by design (just the logo +
  // title over the brand-colour arc), so picking a photo alongside it would
  // never actually show — grey the Photos grid out rather than let staff
  // pick one and wonder why it's not appearing on the cover. "Split panel"
  // does render a photo (in its image drop-zone), so photos stay enabled there.
  const photosDisabled = selectedTemplate === 'circles'
  return (
    <div className="step-content">
      <h2 className="step-title">Cover Image</h2>
      <p className="step-desc">
        Choose a branded cover layout, a cover photo, or leave as default.
        You can also upload a custom image specific to this property.
        Recommended size: 1414×2000px (portrait, A4 ratio) — other ratios will be cropped to fit.
      </p>

      <h3 className="step-subtitle">Branded templates</h3>
      <div className="cover-grid">
        {BRANDED_COVER_TEMPLATES.map(opt => {
          const optTemplate = opt.id.split(':')[1]
          return (
            <button
              key={opt.id}
              className={`cover-option ${selectedTemplate === optTemplate ? 'cover-option--selected' : ''}`}
              onClick={() => setDraft(d => {
                // Switching templates keeps an already-picked photo only when
                // moving between templates that both support one (currently
                // just "split" itself); "circles" never carries a photo.
                const { photoUrl } = parseCoverUrl(d.cover.coverUrl)
                const nextPhoto = optTemplate === 'split' ? photoUrl : ''
                return { ...d, cover: { ...d.cover, coverUrl: buildCoverUrl(optTemplate, nextPhoto) } }
              })}
            >
              <div className={`cover-swatch cover-swatch--${optTemplate}`}>
                {optTemplate === 'circles' && <span className="cover-swatch__arc" />}
                {optTemplate === 'split' && (
                  <>
                    <span className="cover-swatch__hero" />
                    <span className="cover-swatch__panel" />
                    <span className="cover-swatch__footer-bar" />
                  </>
                )}
              </div>
              <span className="cover-option__label">{opt.label}</span>
            </button>
          )
        })}
      </div>

      <h3 className="step-subtitle">Photos</h3>
      {photosDisabled && (
        <p className="cover-photos-hint">
          Not used with the &ldquo;Teal — brand circles&rdquo; template — switch to a photo cover or Split panel to pick one.
        </p>
      )}
      {selectedTemplate === 'split' && !photosDisabled && (
        <p className="cover-photos-hint">Shown in the Split panel&rsquo;s image area.</p>
      )}
      <div className={`cover-grid ${photosDisabled ? 'cover-grid--disabled' : ''}`}>
        {COVER_OPTIONS.map(opt => {
          const isSelected = selectedTemplate === 'split' ? selectedPhotoUrl === opt.url : draft.cover.coverUrl === opt.url
          return (
            <button
              key={opt.url}
              className={`cover-option ${isSelected ? 'cover-option--selected' : ''}`}
              disabled={photosDisabled}
              onClick={() => setDraft(d => {
                const { template } = parseCoverUrl(d.cover.coverUrl)
                const nextCoverUrl = template === 'split' ? buildCoverUrl('split', opt.url) : opt.url
                return { ...d, cover: { ...d.cover, coverUrl: nextCoverUrl } }
              })}
            >
              <div className="cover-option__img" style={{ backgroundImage: `url(${opt.url})` }} />
              <span className="cover-option__label">{opt.label}</span>
            </button>
          )
        })}
      </div>

      <label className="cover-upload">
        <input type="file" accept="image/*" hidden
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              const url = URL.createObjectURL(file)
              setDraft(d => {
                const { template } = parseCoverUrl(d.cover.coverUrl)
                const nextCoverUrl = template === 'split' ? buildCoverUrl('split', url) : url
                return { ...d, cover: { ...d.cover, coverUrl: nextCoverUrl, uploadFile: file } }
              })
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

        .step-subtitle {
          font-family: var(--font-comfortaa); font-size: 12px; font-weight: 700;
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--nv-text-muted);
          margin: 18px 0 4px;
        }
        .cover-photos-hint { font-size: 12px; color: var(--nv-text-muted); margin: 0 0 8px; }
        .cover-grid--disabled { opacity: 0.4; }
        .cover-grid--disabled .cover-option { cursor: not-allowed; }
        .cover-swatch {
          height: 80px; position: relative; overflow: hidden;
          background: var(--nv-blue-slate);
        }
        .cover-swatch__arc {
          position: absolute; left: -34px; bottom: -34px; width: 80px; height: 80px;
          border-radius: 50%; border: 1px solid rgba(255,255,255,0.35);
        }
        .cover-swatch--split { background: #fff; display: flex; flex-direction: column; }
        .cover-swatch__hero { flex: 1 1 58%; background: var(--nv-platinum); }
        .cover-swatch__panel { flex: 1 1 27%; background: #EEF3F5; }
        .cover-swatch__footer-bar { flex: 0 0 15%; background: #1A3D4A; }
      `}</style>
    </div>
  )
}

/* ─── Step 7: Terms & Conditions ─── */
function Step6Terms({ draft, setDraft, errors, entities = [], entitiesLoading }: StepProps) {
  const terms = draft.terms

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
        <FormField label="Governing Entity" error={errors.governingEntityCode}>
          <select className="nv-input" value={terms.governingEntityCode}
            onChange={e => updateTerms({ governingEntityCode: e.target.value })}
            disabled={entitiesLoading}>
            <option value="">{entitiesLoading ? 'Loading entities…' : 'Select an entity…'}</option>
            {entities.map(en => (
              <option key={en.entity_code} value={en.entity_code}>
                {en.legal_name} ({en.entity_code})
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <TermsEditor clauses={terms.clauses} onChange={updateClauses} />
      <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm terms-add-clause" onClick={addClause}>
        + Add Clause
      </button>

      <style jsx>{`
        .terms-add-clause { margin-top: 4px; margin-bottom: 20px; }
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

/* Step 7 (Signature) removed entirely — it had already been reduced to a
   read-only confirmation of Settings-sourced values with nothing left to
   configure, so there was no reason to keep a whole wizard step for it.
   draft.terms.signatureRequired/signatureMethod/signatoryName/
   signatureDataUrl still exist and still feed the letter's sign-off (see
   ProposalDocument.tsx / exportDocx.ts) — signatureRequired just has no UI
   toggle anymore and stays at its serviceCatalog.ts initTerms default of
   `true`, so the sign-off always shows, sourced from Settings → User
   Settings (My Signature). A user who hasn't set one up there will simply
   see "Signature not yet captured" on the letter. */

/* ─── Step 7: Preview & Save ─── */
function Step7Preview({ draft, setDraft, staff = [], onDocumentReady }: StepProps) {
  const model = buildDocModelFromDraft(draft, staff)
  function savePages(document: A4Document) {
    setDraft(d => ({ ...d, terms: { ...d.terms, pageBreaks: { ...d.terms.pageBreaks, _document: document } } }))
  }
  return <div className="step-content">
    <h2 className="step-title">Preview & Save</h2>
    <p className="step-desc">Edit directly on each A4 sheet — content flows onto the next page automatically as you type or delete, just like Word. Use each page’s own toolbar for a manual page break or a precise move. Save Document below saves the pages exactly as arranged.</p>
    <A4DocumentEditor model={model} onChange={savePages} onReady={onDocumentReady!} />
  </div>
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
  onDocumentReady?: (ready: boolean) => void
  draft: ProposalDraft
  setDraft: React.Dispatch<React.SetStateAction<ProposalDraft>>
  errors: Record<string, string>
  staff?: M365Staff[]
  staffLoading?: boolean
  staffError?: string
  // Only used by Step1HotelDetails — whether we're editing an existing
  // (already-saved) proposal, so it knows not to clobber the loaded
  // regionSettings/terms snapshot with fresh Region Settings defaults.
  editId?: string | null
  // Only used by Step1HotelDetails's region <select> — lives in the parent
  // (NewProposalPage) rather than the step itself so it survives navigating
  // past step 1 (the step component unmounts on every step change, which
  // previously dropped an in-flight Region Settings fetch on the floor).
  applyRegionSettings?: (region: Region) => void
  // Settings → Service Lines categories — used by Step2Services to render
  // the selectable list, and by Step3Scope/Step4Pricing to label/color each
  // selected service line's section header with the live Settings label
  // rather than the (possibly stale, code-only) fallback.
  serviceCategories?: ServiceCategory[]
  serviceCategoriesLoading?: boolean
  // Only used by Step6Terms's Governing Entity picker — see the entities/
  // entitiesLoading state comment in NewProposalPage.
  entities?: RegistryEntity[]
  entitiesLoading?: boolean
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
  .step-header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .confidential-toggle {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    padding: 7px 14px 7px 10px; border-radius: 999px; border: 1.5px solid var(--nv-border);
    background: none; font-size: 12.5px; font-weight: 600; color: var(--nv-text-muted);
    cursor: pointer; white-space: nowrap;
  }
  .confidential-toggle--active {
    border-color: var(--nv-blue-slate); color: var(--nv-blue-slate); background: rgba(40,104,127,0.06);
  }
  .confidential-toggle__check {
    width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--nv-border);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    transition: background 150ms, border-color 150ms;
  }
  .confidential-toggle--active .confidential-toggle__check {
    background: var(--nv-blue-slate); border-color: var(--nv-blue-slate);
  }
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
    if (!draft.hotel.name)          errs.hotelName    = 'Property name is required'
    if (!draft.hotel.contactName)   errs.contactName  = 'Contact name is required'
    if (!draft.hotel.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.hotel.contactEmail))
      errs.contactEmail = 'Valid email required'
  }
  if (draft.step === 2 && draft.services.length === 0) {
    errs.services = 'Please select at least one service'
  }
  // No signature validation block anymore: the Signature step itself was
  // removed, and signatoryName/signatureDataUrl are sourced from Settings
  // (My Signature) rather than typed in anywhere in this wizard, so there's
  // no field left to fix a validation error against. A missing signature
  // just renders as "Signature not yet captured" on the letter.
  return errs
}
