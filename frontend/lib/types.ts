// ─── Proposal System Types ───────────────────────────────────────────────────

export type ProposalStatus = 'draft' | 'generated' | 'sent' | 'signed' | 'expired' | 'fully_signed'
export type ServiceCode     = 'RM' | 'SM' | 'MK' | 'CR'
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

export type SignatureMethod = 'type' | 'draw'

export interface ProposalTerms {
  clauses:           TermsClause[]
  validityDays:      number
  signatureRequired: boolean
  // How the signatory provides their signature — typed (rendered in a script
  // font) or hand-drawn on a canvas. `signatoryName` doubles as the printed
  // name under the mark either way; `signatureDataUrl` holds the drawn PNG.
  signatureMethod:   SignatureMethod
  signatoryName:     string
  signatoryTitle:    string
  signatureDataUrl:  string
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
    hubspotCompanyId?: string   // HubSpot Company id — resolved via /hubspot/search or created via /hubspot/clients
    hubspotContactId?: string   // HubSpot Contact id — resolved via /hubspot/search or created via /hubspot/clients
  }

  // Step 2 — Service Lines
  services: DraftServiceLine[]

  // Step 5 — Sender
  sender: {
    staffId: string
    accountManagerId: string
    message: string
  }

  // Step 6 — Cover
  cover: {
    coverUrl: string
  }

  // Step 7 — Terms & Conditions
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

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
