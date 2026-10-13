import type { A4Document, PageLayoutSettings } from './a4Document'
import { readA4Document } from './a4Document'
// ─── Proposal Document Model ─────────────────────────────────────────────────
// A normalized, presentation-ready shape that both the wizard's Preview & Send
// step (working from an in-progress ProposalDraft) and the Proposal Details
// page (working from a saved proposal fetched over the API) can build, so a
// single <ProposalDocument> component and a single DOCX/PDF export path can
// serve both places instead of duplicating the document layout twice.

import type { ProposalDraft, ScopeItem, FeeRow, PricingFootnote, TermsClause } from './types'
import { getServiceLabel, currencySymbol, computeFeeTotals, sumFeeTotals, type FeeTotals } from './serviceCatalog'

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
  return resolvePlaceholders(html, serviceLabel, hotelName)
}

// NUVCL-156: the Step 1 default text carries `[Property Name]`, but this used
// to replace only `[hotel name]`, so the property token was never filled in.
// Matches both spellings, any case, and a non-breaking space between the
// words (rich-text editors sometimes store one), plus `[service]`.
const SERVICE_TOKEN  = /\[\s*service\s*\]/gi
const PROPERTY_TOKEN = /\[\s*(?:property|hotel)(?:\s|&nbsp;|\u00a0)+name\s*\]/gi
export function resolvePlaceholders(html: string, serviceLabel: string, hotelName: string): string {
  if (!html) return html
  // Escaped because the result is HTML ("A & B" is a valid document name),
  // and passed as functions so a "$" in a name isn't read as a replace pattern.
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let out = html
  if (serviceLabel) out = out.replace(SERVICE_TOKEN, () => esc(serviceLabel))
  if (hotelName) out = out.replace(PROPERTY_TOKEN, () => esc(hotelName))
  return out
}

// Saved A4 pages hold a frozen HTML snapshot of the letter, so a snapshot
// taken while the bug above was live still shows the literal tokens. Resolve
// them at render/export time too. Signed documents are left exactly as signed.
export function resolveSavedPagePlaceholders(value: A4Document, model: Pick<ProposalDocModel, 'title' | 'hotelName' | 'clientSignedAt'>): A4Document {
  if (model.clientSignedAt) return value
  const serviceLabel = model.title.toLowerCase()
  return { ...value, pages: value.pages.map(p => p.kind === 'body' ? { ...p, html: resolvePlaceholders(p.html, serviceLabel, model.hotelName) } : p) }
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
  /** Hotel group name — shown in the running header at the top of each page. */
  hotelGroupName:    string
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
  // print/PDF output (public/print-rules.css's `.doc-section--break`) and,
  // via that same stylesheet, by the Preview & Save step's Paged.js
  // pagination preview (PaginatedPreview.tsx) — no effect on
  // <ProposalDocument>'s own on-screen rendering, which is always a single
  // continuous .doc-flow regardless of these flags (see that component's
  // comment on why).
  pageBreaks:        PageLayoutSettings
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
  // NUVCL-154: labels of the services the client accepted / did not accept
  // when signing. Both empty = not signed yet, or signed before per-service
  // acceptance existed (everything accepted).
  clientAcceptedServices: string[]
  clientDeclinedServices: string[]
}

// Which of ProposalDocument's category sections currently have content to
// show — Background/Scope of Works/Fee Structure disappear together when
// the wizard's Services step was skipped, "Nuvho Pty Ltd" always shows, and
// Terms & Conditions needs both Services AND at least one clause. This is
// the SAME visibility logic <ProposalDocument> derives internally (showBackground/
// showScope/showFees/showAppendix — see that component), pulled out here as
// one shared, pure source of truth so anything that needs the same list
// OUTSIDE ProposalDocument's own JSX can't quietly drift out of sync with
// what it actually renders. Used by PaginatedPreview.tsx's "Page Break"
// toggle strip: Paged.js renders ProposalDocument's content into its own
// cloned/paginated page boxes, which have no React event handlers at all,
// so the wizard's per-section "Page Break" checkboxes can't live inline
// inside that paginated output the way they used to — this list is what
// lets that strip render only the checkboxes that actually correspond to a
// section the document will show.
export function getVisibleSections(model: ProposalDocModel): { key: string; label: string }[] {
  const showServices = model.services.length > 0
  const sections: { key: string; label: string }[] = []
  if (showServices) sections.push({ key: 'background', label: 'Background' })
  if (showServices) sections.push({ key: 'scope', label: 'Scope of Works' })
  sections.push({ key: 'nuvho', label: model.companyName || 'Nuvho Pty Ltd' })
  if (showServices) sections.push({ key: 'fees', label: 'Fee Structure' })
  if (showServices && model.clauses.length > 0) sections.push({ key: 'appendix', label: 'Terms & Conditions' })
  return sections
}

// "Central Reservations" + "Marketing Services" → "Central Reservations & Marketing Services"
// (appends "Services" once at the end, not per-label, since some catalog labels already carry it)
export function proposalTitle(labels: string[]): string {
  if (labels.length === 0) return 'Services Proposal'
  const joined = labels.join(' & ')
  return /services$/i.test(joined) ? joined : `${joined} Services`
}

// NUVCL-157: the cover shows the service title without the trailing
// "Services" — "Sales & Revenue Management Services" → "Sales & Revenue
// Management". Since 2026-10-13 the letter's "RE:" line drops it too; the
// body copy keeps the full title.
export function coverTitle(title: string): string {
  const trimmed = (title || '').replace(/\s+services$/i, '').trim()
  return trimmed || 'Proposal'
}

function formatToday(): string {
  return new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface StaffLike { id: string; name: string; email: string; role: string; role_type: string }

/** Build the document model from the in-progress wizard draft (Preview & Send step). */
export function buildDocModelFromDraft(
  draft: ProposalDraft, staff: StaffLike[],
  // Settings → Service Lines titles by code, so custom lines (e.g. CA) show
  // "Confidentiality Agreement" rather than the bare code.
  serviceLabels: Record<string, string> = {},
): ProposalDocModel {
  const sender = staff.find(s => s.id === draft.sender.staffId)
  const services: DocServiceGroup[] = draft.services.map(s => ({
    code: s.code, label: getServiceLabel(s.code, serviceLabels[s.code]),
    scopeItems: s.scopeItems, feeRows: s.feeRows, footnotes: s.footnotes,
  }))
  const title = proposalTitle(services.map(s => s.label))

  return {
    title,
    hotelName:         draft.hotel.name,
    hotelGroupName:    draft.hotel.hotelGroupName || '',
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
    clientAcceptedServices: [],
    clientDeclinedServices: [],
  }
}

/** Build the document model from a saved proposal as returned by GET /proposals/:id. */
export function buildDocModelFromProposal(p: any): ProposalDocModel {
  const rawServices: any[] = p.services || []
  const services: DocServiceGroup[] = rawServices.map(s => ({
    code:       s.code,
    label:      getServiceLabel(s.code, s.label || undefined),
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
    hotelGroupName:    p.hotel_group_name || '',
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
    clientAcceptedServices: rawServices.filter(s => s.acceptance === 'accepted').map(s => getServiceLabel(s.code, s.label || undefined)),
    clientDeclinedServices: rawServices.filter(s => s.acceptance === 'declined').map(s => getServiceLabel(s.code, s.label || undefined)),
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

/** Fee Structure totals for the whole document — every service the client
 *  hasn't declined (clientDeclinedServices holds labels). Shared by the
 *  on-screen/PDF table (ProposalDocument), the Word export and the A4
 *  editor's live recalculation so all three always agree. */
export function documentFeeTotals(model: Pick<ProposalDocModel, 'services' | 'clientDeclinedServices'>): FeeTotals {
  const declined = new Set(model.clientDeclinedServices || [])
  return sumFeeTotals(model.services.filter(s => !declined.has(s.label)).map(s => computeFeeTotals(s.feeRows)))
}
export function formatMoney(symbol: string, amount: number): string {
  return `${symbol}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
/** Text of the Fee Structure total rows, keyed by the class the A4 editor
 *  uses to find and refresh each value cell. Rows with nothing to show are
 *  omitted (the contract total always shows) unless includeEmpty — the A4
 *  editor needs every value so a row already on the page can drop to zero. */
export const FEE_SUM_RATE_NOTE = 'Day rates, hourly rates and commissions are charged as incurred and are not included in the totals above.'
export function feeSumRows(t: FeeTotals, symbol: string, includeEmpty = false): { cls: string; label: string; value: string }[] {
  const rows: { cls: string; label: string; value: string }[] = []
  if (t.monthly || includeEmpty) rows.push({ cls: 'doc-fee-sum--monthly', label: 'Total monthly fees', value: `${formatMoney(symbol, t.monthly)} / month` })
  if (t.setup + t.oneOff || includeEmpty) rows.push({ cls: 'doc-fee-sum--oneoff', label: 'Total setup & one-off fees', value: formatMoney(symbol, t.setup + t.oneOff) })
  rows.push({ cls: 'doc-fee-sum--contract', label: 'Total contract value', value: formatMoney(symbol, t.contract) })
  return rows
}

/** Fingerprint of the wizard data that the A4 pages are generated from —
 *  letter, scope, pricing, footnotes, service order and T&C. Stored on the
 *  saved A4 document (A4Document.sourceKey) when its pages are laid out, so
 *  Preview & Save can tell the pages are out of date and prompt a rebuild.
 *  Values are normalised so a save → reload round trip (null ↔ '', number
 *  formatting) never reads as a change; the cover is left out because it is
 *  always refreshed live. */
export function documentSourceKey(draft: ProposalDraft): string {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
  const n = (v: unknown) => (v === '' || v == null ? '' : Number(v))
  const data = {
    h: [draft.hotel.name, draft.hotel.hotelGroupName, draft.hotel.contactName, draft.hotel.contactTitle,
        draft.hotel.contactEmail, draft.hotel.contactPhone].map(t),
    r: [draft.regionSettings.address, draft.regionSettings.companyName, draft.regionSettings.aboutNuvho,
        draft.regionSettings.footerText, draft.regionSettings.currency].map(t),
    m: [t(draft.sender.staffId), t(draft.sender.message)],
    s: draft.services.map(s => [
      s.code,
      s.scopeItems.map(i => [t(i.sectionHeading), t(i.text), !!i.enabled]),
      s.feeRows.map(r => [t(r.component), t(r.feeType), n(r.setupFee), n(r.fee), n(r.term)]),
      s.footnotes.map(f => t(f.text)),
    ]),
    c: draft.terms.clauses.map(c => [t(c.heading), t(c.text), !!c.enabled]),
    v: n(draft.terms.validityDays),
  }
  // cyrb53 — small, fast, non-cryptographic; only has to detect change.
  const str = JSON.stringify(data)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `v1-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

/** true = saved pages predate wizard changes; false = in sync;
 *  null = no saved pages, or pages saved before sourceKey existed. */
export function savedPagesStale(draft: ProposalDraft): boolean | null {
  const saved = readA4Document(draft.terms.pageBreaks || {})
  if (!saved?.sourceKey) return null
  return saved.sourceKey !== documentSourceKey(draft)
}
