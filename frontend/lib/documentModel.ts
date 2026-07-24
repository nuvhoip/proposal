// ─── Proposal Document Model ─────────────────────────────────────────────────
// A normalized, presentation-ready shape that both the wizard's Preview & Send
// step (working from an in-progress ProposalDraft) and the Proposal Details
// page (working from a saved proposal fetched over the API) can build, so a
// single <ProposalDocument> component and a single DOCX/PDF export path can
// serve both places instead of duplicating the document layout twice.

import type { ProposalDraft, ScopeItem, FeeRow, PricingFootnote, TermsClause } from './types'
import { SERVICE_CATALOG, deriveFeeSummary } from './serviceCatalog'

export const ROLE_LABELS: Record<string, string> = {
  exec: 'Executive', bd: 'Business Development', account_manager: 'Account Manager',
  delivery: 'Delivery', ops: 'Operations', support: 'Support',
}

export interface DocServiceGroup {
  code:       string
  label:      string
  scopeItems: ScopeItem[]
  feeRows:    FeeRow[]
  footnotes:  PricingFootnote[]
}

export interface ProposalDocModel {
  title:             string
  hotelName:         string
  contactName:       string
  propertyAddress:   string
  dateIssued:        string   // pre-formatted display date, e.g. "23 July 2026"
  coverUrl:          string
  introMessage:      string
  senderName:        string
  senderRoleLabel:   string
  senderEmail:       string
  services:          DocServiceGroup[]
  grandTotalMonthly: number
  footnotes:         PricingFootnote[]
  validityDays:      number
  signatureRequired: boolean
  signatureMethod:   'type' | 'draw'
  signatoryName:     string
  signatoryTitle:    string
  signatureDataUrl:  string
  clauses:           TermsClause[]
}

// "Central Reservations" + "Marketing Services" → "Central Reservations & Marketing Services"
// (appends "Services" once at the end, not per-label, since some catalog labels already carry it)
export function proposalTitle(labels: string[]): string {
  if (labels.length === 0) return 'Services Proposal'
  const joined = labels.join(' & ')
  return /services$/i.test(joined) ? joined : `${joined} Services`
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface StaffLike { id: string; name: string; email: string; role_type: string }

/** Build the document model from the in-progress wizard draft (Preview & Send step). */
export function buildDocModelFromDraft(draft: ProposalDraft, staff: StaffLike[]): ProposalDocModel {
  const sender = staff.find(s => s.id === draft.sender.staffId)
  const services: DocServiceGroup[] = draft.services.map(s => ({
    code: s.code, label: SERVICE_CATALOG[s.code].label,
    scopeItems: s.scopeItems, feeRows: s.feeRows, footnotes: s.footnotes,
  }))
  const title = proposalTitle(services.map(s => s.label))

  return {
    title,
    hotelName:         draft.hotel.name,
    contactName:       draft.hotel.contactName,
    propertyAddress:   draft.hotel.propertyAddress,
    dateIssued:        formatToday(),
    coverUrl:          draft.cover.coverUrl,
    introMessage:      draft.sender.message || `I am pleased to present this proposal to undertake ${title.toLowerCase()} for ${draft.hotel.name || 'your property'}. This document represents our commercial proposal, incorporating our recommended scope of works, fee structure and terms of engagement.`,
    senderName:        sender?.name || '',
    senderRoleLabel:   sender ? (ROLE_LABELS[sender.role_type] || sender.role_type) : '',
    senderEmail:       sender?.email || '',
    services,
    grandTotalMonthly: services.reduce((sum, s) => sum + deriveFeeSummary(s.feeRows).monthlyFee, 0),
    footnotes:         services.flatMap(s => s.footnotes).filter(f => f.text.trim()),
    validityDays:      draft.terms.validityDays,
    signatureRequired: draft.terms.signatureRequired,
    signatureMethod:   draft.terms.signatureMethod,
    signatoryName:     draft.terms.signatoryName,
    signatoryTitle:    draft.terms.signatoryTitle,
    signatureDataUrl:  draft.terms.signatureDataUrl,
    clauses:           draft.terms.clauses.filter(c => c.enabled),
  }
}

/** Build the document model from a saved proposal as returned by GET /proposals/:id. */
export function buildDocModelFromProposal(p: any): ProposalDocModel {
  const rawServices: any[] = p.services || []
  const services: DocServiceGroup[] = rawServices.map(s => ({
    code:       s.code,
    label:      SERVICE_CATALOG[s.code as keyof typeof SERVICE_CATALOG]?.label || s.code,
    scopeItems: s.scope_items || [],
    feeRows:    s.fee_rows || [],
    footnotes:  s.footnotes || [],
  }))
  const title  = proposalTitle(services.map(s => s.label))
  const terms  = p.terms || {}
  const sender = p.sender || null

  return {
    title,
    hotelName:         p.hotel_name || '',
    contactName:       p.contact_name || '',
    propertyAddress:   p.property_address || '',
    dateIssued:        p.created_at ? new Date(p.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : formatToday(),
    coverUrl:          p.cover_url || '',
    introMessage:      p.sender_message || `I am pleased to present this proposal to undertake ${title.toLowerCase()} for ${p.hotel_name || 'your property'}. This document represents our commercial proposal, incorporating our recommended scope of works, fee structure and terms of engagement.`,
    senderName:        sender?.name || '',
    senderRoleLabel:   sender ? (ROLE_LABELS[sender.role_type] || sender.role_type) : '',
    senderEmail:       sender?.email || '',
    services,
    grandTotalMonthly: services.reduce((sum, s) => sum + deriveFeeSummary(s.feeRows).monthlyFee, 0),
    footnotes:         services.flatMap(s => s.footnotes).filter((f: PricingFootnote) => f.text.trim()),
    validityDays:      terms.validityDays ?? 30,
    signatureRequired: terms.signatureRequired ?? false,
    signatureMethod:   terms.signatureMethod === 'draw' ? 'draw' : 'type',
    signatoryName:     terms.signatoryName || '',
    signatoryTitle:    terms.signatoryTitle || '',
    signatureDataUrl:  terms.signatureDataUrl || '',
    clauses:           (terms.clauses || []).filter((c: TermsClause) => c.enabled),
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
