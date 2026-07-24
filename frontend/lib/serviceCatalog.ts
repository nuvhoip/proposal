// ─── Service Catalog ──────────────────────────────────────────────────────────
// Ported from the standalone prototype (nuvho-proposal-generator.jsx SCHEMA.serviceLines).
// Provides the default scope-of-work sections, pricing rows, and footnotes for
// each service line code, plus initializer helpers used by the wizard's
// Scope / Pricing / Terms steps.

import type {
  FeeRow, FeeType, PricingFootnote, ProposalTerms, Region, ScopeItem,
  ServiceCode, TermsClause,
} from './types'

export interface ScopeSectionItemDef {
  id:         string
  text:       string
  defaultOn?: boolean   // defaults to true when omitted
}

export interface ScopeSectionDef {
  id:      string
  heading: string
  items:   ScopeSectionItemDef[]
}

export interface DefaultPricingRowDef {
  component: string
  feeType:   FeeType
  fee:       string
  term:      string
  note:      string
}

export interface ServiceCatalogEntry {
  code:               ServiceCode
  label:              string
  color:              string
  sections:           ScopeSectionDef[]
  defaultPricingRows: DefaultPricingRowDef[]
  pricingFootnotes:   string[]
}

export const FEE_TYPES: { value: FeeType; label: string }[] = [
  { value: 'monthly',    label: 'Monthly Retainer' },
  { value: 'setup',      label: 'Setup Fee' },
  { value: 'fixed',      label: 'Fixed Fee' },
  { value: 'daily',      label: 'Day Rate' },
  { value: 'hourly',     label: 'Hourly Rate' },
  { value: 'commission', label: 'Commission %' },
  { value: 'custom',     label: 'Custom' },
]

export const REGION_META: Record<Region, { currency: string; govLaw: string }> = {
  au: { currency: 'AUD', govLaw: 'Queensland, Australia' },
  uk: { currency: 'GBP', govLaw: 'England & Wales' },
  ie: { currency: 'EUR', govLaw: 'Ireland' },
}

export const SERVICE_CATALOG: Record<ServiceCode, ServiceCatalogEntry> = {
  RM: {
    code: 'RM', label: 'Revenue Management', color: 'var(--nv-blue-slate, #28687f)',
    sections: [
      { id: 'rm_21', heading: 'Revenue Management Services', items: [
        { id: 'rm_audit',     text: 'Audit – Conduct market assessment and market share analysis to inform broad recommendations for yield strategy based on the value matrix.' },
        { id: 'rm_setup',     text: 'Setup – Setup property across our various systems and create process efficiencies.' },
        { id: 'rm_rev365',    text: 'Revenue 365 – Supply a daily report comprising a 365-day rolling forecast and incorporating market pricing & competitor pricing.' },
        { id: 'rm_strategy',  text: 'Strategy Consultation – Conduct 3 x weekly strategy sessions with the property with recommendations on pricing implementation.' },
        { id: 'rm_roomrate',  text: 'Room & Rate Strategy – Review and set up the room structure, pricing matrix, value matrix, interface across systems and propagate across channels.' },
        { id: 'rm_yield',     text: 'Yield Management – Manage overall pricing and yield management including updating and propagation of rates across channels.' },
        { id: 'rm_ota',       text: 'OTA Management – Ongoing management of OTA channels, relationships, accounts and represent the property with OTA account managers.' },
        { id: 'rm_gds',       text: 'GDS Management – Ongoing management of GDS relationships and represent the property with GDS account managers.' },
        { id: 'rm_forecast',  text: 'Forecasting – Provide rolling top-line twelve-month forecasts.' },
        { id: 'rm_budget',    text: 'Budget – Provide twelve-month rooms revenue budget broken down into market segments per month; provided once per contract year.' },
        { id: 'rm_reporting', text: 'Reporting – Provide reporting measuring performance against the competitive set and the same period last year including an end of month report focusing on key revenue metrics.' },
      ] },
    ],
    defaultPricingRows: [
      { component: 'Setup Fee',          feeType: 'setup',   fee: '1500', term: '',   note: '' },
      { component: 'Monthly Management', feeType: 'monthly', fee: '7499', term: '12', note: 'Includes Room Price Genie & Revenue 365' },
    ],
    pricingFootnotes: [
      'Our fees include subscription costs to Room Price Genie and our internal Revenue 365 report.',
      'Our fees exclude advertising costs, third party systems and any out-of-pocket expenses.',
    ],
  },
  SM: {
    code: 'SM', label: 'Sales Management', color: 'var(--nv-steel-blue, #6ba1bf)',
    sections: [
      { id: 'sm_21', heading: 'New Property Set Up', items: [
        { id: 'sm_planning',  text: 'Sales Planning – Develop a sales activity plan by market segment including strategy and tactics.' },
        { id: 'sm_acctsetup', text: 'Account Setup – Establish the properties in Pipedrive CRM, email inbox and configure reporting on an agreed basis.' },
        { id: 'sm_templates', text: 'Template Development – Where required, create a suite of templates for use in the proposal and request for tender process.' },
      ] },
      { id: 'sm_22', heading: 'Business Development', items: [
        { id: 'sm_calls',    text: 'Sales Calls & Emails – Conduct connected reactive and proactive research, sales calls and emails incorporating an agreed blend of segments to hit an average of 90 connects per month.' },
        { id: 'sm_tenders',  text: 'Tenders & RFPs – Undertake tenders and requests for proposals on demand based on client requirements.' },
        { id: 'sm_site',     text: 'Site Inspections – Facilitate site inspections to showcase the property to local accounts.' },
        { id: 'sm_resource', text: 'Dedicated Resource – Assign dedicated team members assigned to execute sales strategy and tactics.' },
      ] },
      { id: 'sm_23', heading: 'Account Management', items: [
        { id: 'sm_acctmgmt', text: 'Account Management – Implement and execute account management strategies to ensure both company and TMCs are being targeted.' },
      ] },
      { id: 'sm_24', heading: 'Administration', items: [
        { id: 'sm_reporting', text: 'Reporting – Provide a monthly activity report highlighting sales activities, return on investment as well as maintain a live online dashboard identifying the forward pipeline of business.' },
        { id: 'sm_consult',   text: 'Strategy Consult – Conduct on-going and interim consultation with the property to provide feedback on return on investment & performance.' },
        { id: 'sm_mgmt',      text: 'Sales Management – Management of overall sales strategy and implementation.' },
      ] },
    ],
    defaultPricingRows: [
      { component: 'Setup Fee per Outlet', feeType: 'setup',   fee: '1500', term: '',  note: '' },
      { component: 'Monthly Retainer',     feeType: 'monthly', fee: '8500', term: '6', note: '' },
    ],
    pricingFootnotes: [
      'Our fees exclude any out-of-pocket expenses including travel and associated food and beverage expenses.',
    ],
  },
  CR: {
    code: 'CR', label: 'Central Reservations', color: 'var(--nv-teal-light, #80b9bf)',
    sections: [
      { id: 'cr_21', heading: 'Reservation Management Services', items: [
        { id: 'cr_setup',      text: 'Systems Setup – Setup the systems associated with the provision of central reservations including the reservations system, telephony system and chatbot.' },
        { id: 'cr_hours',      text: 'Hours & Location of Service – Provide reservations hours of service from Monday to Friday 9am to 5pm.' },
        { id: 'cr_training',   text: 'Property Research & Training – Coordinate training with the property such that in-depth knowledge of room types and facilities is present.' },
        { id: 'cr_salestrain', text: 'Sales Training – Provide appropriate sales training to reservation personnel in terms of telephony manner, connection, conversion and upselling.' },
        { id: 'cr_inbound',    text: 'Inbound Reservation Handling – Handle all inbound accommodation reservation enquiries from telephone and email channels at all stages of the reservation process.' },
        { id: 'cr_existing',   text: 'Manage Existing Reservations – Manage existing reservations with PMS access.' },
        { id: 'cr_leads',      text: 'Lead Generation – Pass appropriate leads to the sales team in terms of corporate and MICE segments.' },
        { id: 'cr_reports',    text: 'Report Generation – Generate and distribute daily arrivals and no-show reports. Produce monthly reporting on activity comprising calls, proposals, conversion and up-sales.' },
      ] },
    ],
    defaultPricingRows: [
      { component: 'Setup Fee',   feeType: 'setup',   fee: '1500', term: '',   note: '' },
      { component: 'Monthly Fee', feeType: 'monthly', fee: '5999', term: '12', note: '' },
      { component: 'After Hours', feeType: 'monthly', fee: '',     term: '12', note: 'Optional' },
    ],
    pricingFootnotes: [
      'Our fees exclude any third party management systems and out-of-pocket expenses.',
    ],
  },
  MK: {
    code: 'MK', label: 'Marketing Services', color: 'var(--nv-plum, #8b6fb5)',
    sections: [
      { id: 'mkt_21', heading: 'Marketing Services', items: [
        { id: 'mkt_strategy',   text: 'Marketing Strategy – Develop a marketing strategy aligned to commercial objectives and seasonal demand patterns.' },
        { id: 'mkt_content',    text: 'Content Creation – Produce brand-aligned written and visual content for use across digital and print channels.' },
        { id: 'mkt_social',     text: 'Social Media Management – Manage organic social media presence across agreed platforms with a defined posting cadence.' },
        { id: 'mkt_paid',       text: 'Paid Digital Advertising – Plan, execute and optimise paid campaigns across Meta, Google or other agreed platforms.' },
        { id: 'mkt_email',      text: 'Email Marketing – Design and deploy email campaigns to agreed database segments.' },
        { id: 'mkt_seo',        text: 'SEO & Website Content – Conduct on-page SEO optimisation and update website content on an agreed basis.' },
        { id: 'mkt_photo',      text: 'Photography & Video Coordination – Coordinate professional photography and/or video production shoots.' },
        { id: 'mkt_reputation', text: 'Reputation Management – Monitor and respond to online reviews across TripAdvisor, Google and OTA platforms.' },
        { id: 'mkt_reporting',  text: 'Reporting – Provide monthly marketing performance reporting against agreed KPIs.' },
      ] },
    ],
    defaultPricingRows: [
      { component: 'Monthly Retainer', feeType: 'monthly', fee: '', term: '', note: '' },
    ],
    pricingFootnotes: [
      'Our fees exclude advertising spend, third party platform costs and any out-of-pocket expenses.',
    ],
  },
}

let uidCounter = 0
function generateId(prefix: string): string {
  uidCounter += 1
  return `${prefix}_${Date.now()}_${uidCounter}_${Math.random().toString(36).slice(2, 7)}`
}

export function initScopeItems(code: ServiceCode): ScopeItem[] {
  const entry = SERVICE_CATALOG[code]
  return entry.sections.flatMap(section =>
    section.items.map(item => ({
      id:             item.id,
      sectionHeading: section.heading,
      text:           item.text,
      enabled:        item.defaultOn !== false,
    }))
  )
}

export function initFeeRows(code: ServiceCode): FeeRow[] {
  const entry = SERVICE_CATALOG[code]
  return entry.defaultPricingRows.map(row => ({
    id:        generateId('fee'),
    component: row.component,
    feeType:   row.feeType,
    fee:       row.fee === '' ? '' : Number(row.fee),
    term:      row.term === '' ? '' : Number(row.term),
    note:      row.note,
  }))
}

export function initFootnotes(code: ServiceCode): PricingFootnote[] {
  const entry = SERVICE_CATALOG[code]
  return entry.pricingFootnotes.map(text => ({ id: generateId('fn'), text }))
}

export function defaultTermsClauses(region: Region): { heading: string; text: string }[] {
  const meta = REGION_META[region]
  return [
    { heading: 'Payment Terms',           text: `Fees are invoiced in advance (monthly retainers) or on issue (setup/fixed fees) and are payable within 14 days of the invoice date, in ${meta.currency}.` },
    { heading: 'Contract Term & Renewal', text: 'This agreement commences on the date of signing and continues for the term specified against each service. Thereafter it continues on a month-to-month basis unless terminated by either party.' },
    { heading: 'Cancellation',            text: "Either party may terminate this agreement with 60 days' written notice, effective after the expiry of the initial term." },
    { heading: 'Confidentiality',         text: 'Both parties agree to keep confidential all non-public information disclosed in connection with this agreement and this proposal.' },
    { heading: 'Limitation of Liability', text: "Nuvho's aggregate liability under this agreement is limited to the fees paid in the twelve months preceding the claim." },
    { heading: 'Intellectual Property',   text: 'Nuvho retains ownership of all systems, processes, and materials used to deliver the services. The client retains ownership of its own brand assets and data.' },
    { heading: 'Force Majeure',           text: 'Neither party is liable for delay or failure to perform caused by circumstances beyond its reasonable control.' },
    { heading: 'Governing Law',           text: `This agreement is governed by the laws of ${meta.govLaw}, and the parties submit to the exclusive jurisdiction of its courts.` },
  ]
}

export function initTerms(region: Region): ProposalTerms {
  return {
    clauses: defaultTermsClauses(region).map(c => ({
      id:      generateId('term'),
      heading: c.heading,
      text:    c.text,
      enabled: true,
    })),
    validityDays:      30,
    signatureRequired: true,
    signatureMethod:   'type',
    signatoryName:     '',
    signatoryTitle:    '',
    signatureDataUrl:  '',
  }
}

export function generateRowId(prefix: string): string {
  return generateId(prefix)
}

// Sum helpers — derive the flat monthlyFee/setupFee/term summary fields from
// a service line's feeRows (kept in sync with DraftServiceLine for the
// worker's proposal_services columns and dashboard/total calculations).
export function deriveFeeSummary(feeRows: FeeRow[]): { monthlyFee: number; setupFee: number; term: number } {
  const monthlyFee = feeRows
    .filter(r => r.feeType === 'monthly')
    .reduce((sum, r) => sum + (typeof r.fee === 'number' ? r.fee : 0), 0)
  const setupFee = feeRows
    .filter(r => r.feeType === 'setup')
    .reduce((sum, r) => sum + (typeof r.fee === 'number' ? r.fee : 0), 0)
  const term = feeRows.reduce((max, r) => {
    const t = typeof r.term === 'number' ? r.term : 0
    return t > max ? t : max
  }, 0)
  return { monthlyFee, setupFee, term: term || 12 }
}
