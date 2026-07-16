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

// Simplified service line used inside the proposal wizard
export interface DraftServiceLine {
  code:        ServiceCode
  monthlyFee:  number
  setupFee:    number
  term:        number
}

// Proposal generator wizard state (nested per-step structure)
export interface ProposalDraft {
  step: number

  // Step 1 — Hotel & Contact
  hotel: {
    name:            string
    region:          Region
    hgid:            string   // Nuvho Master Registry Hotel Group id (HG-{GEO}-{SEQ4}) — set via typeahead
    entityCode:      string   // registry entity_code resolved from the selected hotel group
    contactName:     string
    contactEmail:    string
    contactPhone:    string
    contactTitle:    string
    propertyAddress: string
    hubspotDealId:   string
  }

  // Step 2 — Service Lines
  services: DraftServiceLine[]

  // Step 3 — Sender
  sender: {
    staffId: string
    message: string
  }

  // Step 4 — Cover
  cover: {
    coverUrl: string
  }

  // Step 5 — Preview
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
