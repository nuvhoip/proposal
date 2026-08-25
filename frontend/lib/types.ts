// ─── Proposal System Types ───────────────────────────────────────────────────

export type ProposalStatus = 'draft' | 'generated' | 'sent' | 'signed' | 'expired' | 'fully_signed'
// Was a fixed 4-value union ('RM'|'SM'|'MK'|'CR'). Widened to `string` because
// service-line categories are now managed from Settings → Body Configuration
// (fully staff-editable — add/rename/delete), so the set of valid codes is no
// longer known at compile time. String-literal codes like 'RM' still satisfy
// this type unchanged; see ServiceCategory below and lib/serviceCatalog.ts's
// getServiceEntry/getServiceLabel/getServiceColor for the safe-lookup pattern
// now required anywhere a code might not have a hardcoded catalog entry.
export type ServiceCode     = string
export type Region          = 'au' | 'uk' | 'ie'

export interface ServiceLine {
  id: string
  code: ServiceCode
  label: string
  description: string
  monthlyFee: number
  setupFee: number
  termMonths: number
  selected: boolean
}

export interface Proposal {
  id: string                   // NP-AU-260610-X7K2M9
  hgidStructural: string       // HG-AU-0004
  hgidDisplay: string          // HG-AU-HRBT
  pidStructural: string
  pidDisplay: string
  slug: string
  hotelName: string
  clientName: string
  clientEmail: string
  clientPhone?: string
  senderId: string
  senderName: string
  senderTitle: string
  bdOwnerStfId?: string
  accountManagerStfId?: string
  regionId: Region
  entityCode: string
  hubspotDealId?: string
  status: ProposalStatus
  services: ServiceLine[]
  createdAt: string
  firstViewedAt?: string
  lastViewedAt?: string
  viewCount: number
  expiryDate: string
  coverImageR2Key?: string
  coverOverlayOpacity: number
  parentProposalId?: string
}

export interface ProposalSummary {
  id: string
  hotelName: string
  clientName: string
  clientEmail: string
  status: ProposalStatus
  regionId: Region
  totalMonthlyValue: number
  servicesCount: number
  createdAt: string
  firstViewedAt?: string
  expiryDate: string
  viewCount: number
}

export interface Staff {
  id: string
  name: string
  email: string
  title: string
  role: 'owner' | 'admin' | 'staff' | 'read_only'
  roleType: 'exec' | 'bd' | 'account_manager' | 'delivery' | 'ops' | 'support'
  bdFacing: boolean
  isSignatory: boolean
  hubspotOwnerId?: string
  asanaGid?: string
  m365UserId?: string
  m365Upn?: string
  timezone: string
  active: boolean
}

// Fee-row type used by the per-service Pricing editor
export type FeeType = 'monthly' | 'setup' | 'fixed' | 'daily' | 'hourly' | 'commission' | 'custom'

// One ordered/toggleable scope-of-work line item, grouped under a section heading
export interface ScopeItem {
  id:             string
  sectionHeading: string
  text:           string
  enabled:        boolean
  isCustom?:      boolean
}

// One editable, reorderable pricing row within a service line
export interface FeeRow {
  id:        string
  component: string
  feeType:   FeeType
  fee:       number | ''
  term:      number | ''
  note:      string
}

// One editable, reorderable footnote / small-print line under a service's pricing table
export interface PricingFootnote {
  id:   string
  text: string
}

// Simplified service line used inside the proposal wizard
export interface DraftServiceLine {
  code:        ServiceCode
  // Flat summary fields — derived from feeRows (kept for backward-compat with
  // the worker's proposal_services columns and existing total/summary calcs)
  monthlyFee:  number
  setupFee:    number
  term:        number
  // Scope of work — ordered, toggleable, inline-editable per service line
  scopeItems:  ScopeItem[]
  // Flexible pricing — draggable fee rows + footnotes per service line
  feeRows:     FeeRow[]
  footnotes:   PricingFootnote[]
}

// One editable, reorderable Terms & Conditions clause
export interface TermsClause {
  id:      string
  heading: string
  text:    string
  enabled: boolean
}

// Per-region defaults edited from Settings → Region Settings and applied onto
// the wizard draft when Hotel Details' region is selected — Nuvho's own
// entity address (letterhead), the legal footer (company registration small
// print), the operating currency, and the default Terms & Conditions clauses
// for that jurisdiction.
export interface RegionSettings {
  region:      Region
  address:     string
  companyName: string   // legal entity name shown as the section heading — e.g. "Nuvho Pty Ltd" (AU); differs per region
  aboutNuvho:  string   // about-us paragraph under that heading — wording can differ per region too
  footerText:  string
  currency:    string   // ISO 4217 code, e.g. 'AUD' | 'GBP' | 'EUR'
  clauses:     TermsClause[]
}

// One default Scope-of-Work bullet within a section, as configured on a
// ServiceCategory in Settings → Body Configuration. Mirrors the worker's
// service_categories.default_scope_json column shape.
export interface ServiceCategoryScopeItem {
  id:   string
  text: string
}

// One default Scope-of-Work section (heading + bullets) as configured on a
// ServiceCategory in Settings → Body Configuration. Fully staff-editable — add/
// edit/remove/reorder both sections and items within a section.
export interface ServiceCategoryScopeSection {
  id:      string
  heading: string
  items:   ServiceCategoryScopeItem[]
}

// One default Small Print / Footnote line (Pricing step) as configured on a
// ServiceCategory in Settings → Body Configuration. Mirrors the worker's
// service_categories.default_footnotes_json column shape — flat, unlike
// Scope of Work's sections, since footnotes render as a single combined list
// with no per-service heading (see Step4Pricing's footnotes-box).
export interface ServiceCategoryFootnote {
  id:   string
  text: string
}

// A main service-line category managed from Settings → Body Configuration — the
// list Step 2 (Services) of the proposal wizard offers to select from. Fully
// staff-editable (add/rename/reorder/deactivate/delete); `code` is stable
// once created (stored on proposal_services.code) even though the category
// itself can later be deleted or renamed. `defaultScope` is the default
// Scope of Work (sections + bullets) copied into a new proposal's Step 3
// when this category is added on Step 2 — editing it here only affects
// proposals created afterward (see the "Settings are a template, not a live
// link" pattern used elsewhere, e.g. RegionSettings clauses). `defaultFootnotes`
// is the same idea for the Pricing step's Small Print / Footnotes.
export interface ServiceCategory {
  code:             string
  label:            string
  description:      string
  sortOrder:        number
  active:           boolean
  defaultScope:     ServiceCategoryScopeSection[]
  defaultFootnotes: ServiceCategoryFootnote[]
}

export type SignatureMethod = 'type' | 'draw'

export interface ProposalTerms {
  clauses:           TermsClause[]
  validityDays:      number
  // Nuvho legal entity whose laws/jurisdiction this agreement is governed by
  // — a registry entity_code (e.g. NVH-AU-OPS), selected on Step 7 from the
  // same live Master Registry entity list Settings → Entities lists (see the
  // Governing Entity picker in app/(app)/proposals/new/page.tsx's
  // Step7Terms). Defaults to the contracting entity chosen on Step 1
  // (hotel.entityCode) but can be overridden — the two need not match if,
  // say, the contract itself should be governed by a different entity than
  // the one billing the client.
  governingEntityCode: string
  signatureRequired: boolean
  // How the signatory provides their signature — typed (rendered in a script
  // font) or hand-drawn on a canvas. `signatoryName` doubles as the printed
  // name under the mark either way; `signatureDataUrl` holds the drawn PNG.
  signatureMethod:   SignatureMethod
  signatoryName:     string
  signatoryTitle:    string
  signatureDataUrl:  string
  // Optional rich-text (HTML, authored via TinyMCE) message shown to the
  // client on the wizard's Signature step (Step 8) — rendered above the
  // signature block on the client-facing document, in place of the default
  // "Should the terms of this proposal be acceptable…" sentence when present.
  signatureMessage:  string
  // Per-category "force a page break before this section" flags, set on the
  // wizard's Preview & Save step (Step7Preview) and honoured by
  // <ProposalDocument> in print/PDF output. Keyed by the same section ids
  // ProposalDocument.tsx's buildTocItems() uses: 'background' | 'scope' |
  // 'nuvho' | 'fees' | 'appendix'. Missing/false = no forced break (default
  // flowing layout, unchanged from before this existed).
  pageBreaks:        Record<string, boolean>
}

// Proposal generator wizard state (nested per-step structure)
export interface ProposalDraft {
  step: number

  // Step 1 — Hotel & Contact
  hotel: {
    name:            string
    region:          Region
    hgid:            string   // Nuvho Master Registry Hotel Group id (HG-{GEO}-{SEQ4}) — set via typeahead
    pid:             string   // Nuvho Master Registry Property id (PRP-{GEO}-{SEQ4}) — resolved/created alongside hgid
    entityCode:      string   // registry entity_code resolved from the selected hotel group
    contactName:     string
    contactEmail:    string
    contactPhone:    string
    contactTitle:    string
    propertyAddress: string
    hubspotDealId:   string
    hubspotDealName?: string    // NUVCL-123: display label for the linked/created HubSpot Deal, resolved via /hubspot/deals/search or /hubspot/deals
    hubspotCompanyId?: string   // HubSpot Company id — resolved via /hubspot/search or created via /hubspot/clients
    hubspotContactId?: string   // HubSpot Contact id — resolved via /hubspot/search or created via /hubspot/clients
  }

  // Region settings snapshot — applied automatically from Settings → Region
  // Settings when hotel.region is selected (see applyRegionSettings() in the
  // wizard). Sent to the worker at create/update time and stored on the
  // proposal row so historical proposals keep the address/footer/currency
  // that applied when they were generated, even if Settings are edited later.
  regionSettings: {
    address:     string
    companyName: string
    aboutNuvho:  string
    footerText:  string
    currency:    string
  }

  // Step 2 — Service Lines
  services: DraftServiceLine[]

  // Sender — no longer its own wizard step (NUVCL-118: the standalone
  // Sender step and its AI email-message composer and attachment upload
  // were removed; the platform is scoped to PDF/DOC generation only for
  // now). staffId still auto-defaults to the signed-in user; accountManagerId
  // and message are now set from Step 1 (Hotel Details) — accountManagerId
  // because it's a client-relationship field, and message because it's
  // actually the letter's opening paragraph (see documentModel.ts's
  // introMessage), not merely an email body. subject/cc/bcc are gone from
  // the wizard; the worker's sendProposalEmail() (used by the Proposal
  // Details page's Send button) still falls back to its own defaults when
  // those DB columns are blank.
  sender: {
    staffId: string
    accountManagerId: string
    message: string
  }

  // Step 5 — Cover
  cover: {
    coverUrl: string
    // Set locally (never sent as-is) when staff pick "Upload custom image" —
    // coverUrl is set to a browser-local `blob:` preview URL at the same
    // time for immediate on-screen preview, but that URL only resolves in
    // this tab. createDraftProposal() uploads this File to the worker's
    // durable cover-photo storage and swaps the blob: URL out for the real
    // URL it gets back before saving.
    uploadFile?: File
  }

  // Step 6 — Terms & Conditions, and Step 7 — Signature. Both steps share
  // this same `terms` slice (clauses/validityDays render on Step 6;
  // signatureRequired/signatureMethod/signatoryName/signatoryTitle/
  // signatureDataUrl/signatureMessage render on Step 7) since the worker
  // persists them together as a single proposal_terms row.
  terms: ProposalTerms

  // Step 8 — Preview
  preview: {
    recipientEmail: string
  }

  // Set after successful generation
  proposalId?: string
  proposalUrl?: string
}

export interface DashboardStats {
  totalProposals:      number
  sentThisMonth:       number
  signedThisMonth:     number
  conversionRate:      number
  totalMonthlyRevenue: number
  pendingFollowups:    number
  avgResponseDays:     number
  pendingSignature:    number
  totalRevenuePending: number
}

// A file attached to the proposal-sent email (wizard Step 5 — Sender),
// already uploaded to the worker (bytes live in R2; see routes/proposals.ts
// uploadAttachment/deleteAttachment). Distinct from a locally-picked File
// that hasn't been uploaded yet — those are held as plain File objects in
// the wizard's local component state, not in this shape or in ProposalDraft.
export interface ProposalAttachment {
  id:           string
  filename:     string
  contentType?: string | null
  sizeBytes:    number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
