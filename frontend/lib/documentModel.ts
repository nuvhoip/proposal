// ─── Proposal Document Model ─────────────────────────────────────────────────
// A normalized, presentation-ready shape that both the wizard's Preview & Send
// step (working from an in-progress ProposalDraft) and the Proposal Details
// page (working from a saved proposal fetched over the API) can build, so a
// single <ProposalDocument> component and a single DOCX/PDF export path can
// serve both places instead of duplicating the document layout twice.

import type { ProposalDraft, ScopeItem, FeeRow, PricingFootnote, TermsClause } from './types'
import { getServiceLabel, deriveFeeSummary, currencySymbol } from './serviceCatalog'

export const ROLE_LABELS: Record<string, string> = {
  exec: 'Executive', bd: 'Business Development', account_manager: 'Account Manager',
  delivery: 'Delivery', ops: 'Operations', support: 'Support',
}

// NUVCL-119 branded cover sentinel — stored as `branded:<id>` (no photo) or
// `branded:<id>::<photoUrl>` (for templates like "split" that also render an
// embedded cover photo) in the existing coverUrl/cover_url string field, so
// no schema migration is needed. Centralised here so the wizard's Step5Cover
// editor (app/(app)/proposals/new/page.tsx) and <ProposalDocument>'s renderer
// parse/build the exact same format.
export function parseCoverUrl(coverUrl: string): { template: string | null; photoUrl: string } {
  if (!coverUrl || !coverUrl.startsWith('branded:')) return { template: null, photoUrl: coverUrl || '' }
  const rest = coverUrl.slice('branded:'.length)
  const sep = rest.indexOf('::')
  return sep === -1 ? { template: rest, photoUrl: '' } : { template: rest.slice(0, sep), photoUrl: rest.slice(sep + 2) }
}
export function buildCoverUrl(template: string, photoUrl?: string): string {
  return photoUrl ? `branded:${template}::${photoUrl}` : `branded:${template}`
}

// Shared with the wizard's Step 1 "Personal message" editor (see
// app/(app)/proposals/new/page.tsx), which auto-fills a new proposal's
// message field with this same text (using literal `[service]`/`[Property Name]`
// placeholders, since neither is known yet at Step 1) so staff see and can
// edit a real starting paragraph instead of an empty field backed only by
// this invisible build-time fallback.
export function buildDefaultIntroMessage(serviceLabel: string, hotelName: string): string {
  return `<p>I am pleased to present this proposal to undertake ${serviceLabel} for ${hotelName}. This document represents our commercial proposal and sets out the following:</p>`
}

// Resolves a Step 1 message — which may be empty, the untouched default
// above (with its literal `[service]`/`[Property Name]` tokens, since neither
// is known that early in the wizard), or a staff-edited version that still
// carries those same tokens — into final HTML with the proposal's real
// service and hotel name substituted in at document/PDF generation time, so
// nobody has to manually replace the brackets before sending.
export function resolveIntroMessage(rawMessage: string, serviceLabel: string, hotelName: string): string {
  const html = rawMessage || buildDefaultIntroMessage(serviceLabel, hotelName)
  return html.replace(/\[service\]/gi, serviceLabel).replace(/\[hotel name\]/gi, hotelName)
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
  // NUVCL-103: contact title/email/phone were captured on Step 1 and shown
  // to staff on the Proposal Details sidebar, but were never surfaced here —
  // so they silently never made it into the generated document. Added so the
  // printed/PDF letter can address the contact the same way the on-screen
  // proposal record does.
  contactTitle:      string
  contactEmail:      string
  contactPhone:      string
  propertyAddress:   string
  nuvhoAddress:      string   // Nuvho entity address for the proposal's region (Settings → Region Settings)
  companyName:       string   // legal entity name shown as the section heading — e.g. "Nuvho Pty Ltd" (AU); differs per region
  aboutNuvho:        string   // about-us paragraph under that heading — wording differs per region too
  footerText:        string   // legal footer / company-registration small print for that region
  currencySymbol:    string   // derived from the region's currency, used instead of a hardcoded '$'
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
  // Optional rich-text (HTML, authored via TinyMCE on the wizard's Signature
  // step) message rendered above the signature block, in place of the
  // default "Should the terms of this proposal be acceptable…" sentence.
  signatureMessage:  string
  clauses:           TermsClause[]
  // Per-category forced-page-break flags from the wizard's Preview & Save
  // step (Step7Preview) — see the matching field on ProposalTerms (lib/
  // types.ts) for the key convention. Honoured by <ProposalDocument> in
  // print/PDF output only; no effect on the on-screen preview layout itself.
  pageBreaks:        Record<string, boolean>
  // The CLIENT's own e-signature, captured via the public sign page's
  // POST /p/:id/sign and stored in dedicated proposal_terms.client_* columns
  // — deliberately separate from signatureMethod/signatoryName/
  // signatureDataUrl above, which are the SENDER's cover-letter sign-off.
  // Empty strings mean "not yet signed". Rendered by <ProposalDocument> at
  // the top of the Terms & Conditions/Appendix section.
  clientSignatoryName:    string
  clientSignatoryTitle:   string
  clientSignatureMethod:  'type' | 'draw'
  clientSignatureDataUrl: string
  clientSignedAt:         string
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

interface StaffLike { id: string; name: string; email: string; role: string; role_type: string }

/** Build the document model from the in-progress wizard draft (Preview & Send step). */
export function buildDocModelFromDraft(draft: ProposalDraft, staff: StaffLike[]): ProposalDocModel {
  const sender = staff.find(s => s.id === draft.sender.staffId)
  const services: DocServiceGroup[] = draft.services.map(s => ({
    code: s.code, label: getServiceLabel(s.code),
    scopeItems: s.scopeItems, feeRows: s.feeRows, footnotes: s.footnotes,
  }))
  const title = proposalTitle(services.map(s => s.label))

  return {
    title,
    hotelName:         draft.hotel.name,
    contactName:       draft.hotel.contactName,
    contactTitle:      draft.hotel.contactTitle,
    contactEmail:      draft.hotel.contactEmail,
    contactPhone:      draft.hotel.contactPhone,
    propertyAddress:   draft.hotel.propertyAddress,
    nuvhoAddress:      draft.regionSettings.address,
    companyName:       draft.regionSettings.companyName,
    aboutNuvho:        draft.regionSettings.aboutNuvho,
    footerText:        draft.regionSettings.footerText,
    currencySymbol:    currencySymbol(draft.regionSettings.currency),
    dateIssued:        formatToday(),
    coverUrl:          draft.cover.coverUrl,
    // sender.message is authored via the rich-text editor on Step 1 (Hotel
    // Details) since NUVCL-118 — always HTML.
    // The fallback default is wrapped in <p> so introMessage is always valid
    // HTML either way (see ProposalDocument.tsx / exportDocx.ts renderers).
    introMessage:      resolveIntroMessage(draft.sender.message, title.toLowerCase(), draft.hotel.name || 'your property'),
    senderName:        sender?.name || '',
    // Their actual job title (staff.role, self-editable in Settings → User
    // Settings), not the generic ROLE_LABELS[role_type] bucket (e.g. plain
    // "Operations") — matches the wording used everywhere else staff are shown.
    senderRoleLabel:   sender?.role || '',
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
    signatureMessage:  draft.terms.signatureMessage || '',
    clauses:           draft.terms.clauses.filter(c => c.enabled),
    pageBreaks:        draft.terms.pageBreaks || {},
    // A draft in progress has never been signed by a client yet.
    clientSignatoryName:    '',
    clientSignatoryTitle:   '',
    clientSignatureMethod:  'type',
    clientSignatureDataUrl: '',
    clientSignedAt:         '',
  }
}

/** Build the document model from a saved proposal as returned by GET /proposals/:id. */
export function buildDocModelFromProposal(p: any): ProposalDocModel {
  const rawServices: any[] = p.services || []
  const services: DocServiceGroup[] = rawServices.map(s => ({
    code:       s.code,
    label:      getServiceLabel(s.code),
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
    contactTitle:      p.contact_title || '',
    contactEmail:      p.contact_email || '',
    contactPhone:      p.contact_phone || '',
    propertyAddress:   p.property_address || '',
    nuvhoAddress:      p.nuvho_address || '',
    companyName:       p.company_name || '',
    aboutNuvho:        p.about_nuvho || '',
    footerText:        p.footer_text || '',
    currencySymbol:    currencySymbol(p.currency || 'AUD'),
    dateIssued:        p.created_at ? new Date(p.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : formatToday(),
    coverUrl:          p.cover_url || '',
    introMessage:      resolveIntroMessage(p.sender_message || '', title.toLowerCase(), p.hotel_name || 'your property'),
    senderName:        sender?.name || '',
    // See the matching comment in buildDocModelFromDraft above — same
    // switch from the generic role_type label to the sender's actual title.
    senderRoleLabel:   sender?.role || '',
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
    signatureMessage:  terms.signatureMessage || '',
    clauses:           (terms.clauses || []).filter((c: TermsClause) => c.enabled),
    pageBreaks:        terms.pageBreaks || {},
    // The client's own e-signature (separate from the sender's cover-letter
    // sign-off above) — populated once /p/:id/sign has been called; see the
    // matching client_* columns added to proposal_terms.
    clientSignatoryName:    terms.clientSignatoryName || '',
    clientSignatoryTitle:   terms.clientSignatoryTitle || '',
    clientSignatureMethod:  terms.clientSignatureMethod === 'draw' ? 'draw' : 'type',
    clientSignatureDataUrl: terms.clientSignatureDataUrl || '',
    clientSignedAt:         terms.clientSignedAt || '',
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
