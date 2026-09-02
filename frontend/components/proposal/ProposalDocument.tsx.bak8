'use client'

import React from 'react'
import { NuvhoLogo, NuvhoIconMark } from '@/components/ui/NuvhoLogo'
import { FEE_TYPES } from '@/lib/serviceCatalog'
import { parseCoverUrl } from '@/lib/documentModel'
import type { ProposalDocModel } from '@/lib/documentModel'

/* Read-only rendering of a normalized ProposalDocModel in the same letter +
   section structure as Nuvho's Word proposal templates: cover, salutation
   letter with a table of contents, Background, Scope of Works (grouped per
   selected service), Nuvho Pty Ltd, Fee Structure, and an Appendix of Terms
   & Conditions.

   Shared by the wizard's Preview & Send step (built from the in-progress
   draft) and the Proposal Details page (built from a saved proposal) so the
   document layout — and its PDF/Word export — only exists in one place.
   The root element's id is the target for the print stylesheet used by the
   "Download PDF" button (see globals.css `@media print`). */

/* Table of contents entries — each links (smooth-scrolls) to the matching
   section id below. Keep in sync with the section wrappers further down.
   The "Nuvho Pty Ltd" entry's label follows the region's Company Name
   (Settings → Region Settings) so it matches whatever the section heading
   itself renders (see below) instead of staying hardcoded to the AU entity. */
function buildTocItems(companyName: string, visible: {
  showBackground: boolean; showScope: boolean; showFees: boolean; showAppendix: boolean
}): { label: string; id: string }[] {
  const items: { label: string; id: string }[] = []
  if (visible.showBackground) items.push({ label: 'Background', id: 'doc-section-background' })
  if (visible.showScope)      items.push({ label: 'Scope of Works', id: 'doc-section-scope' })
  items.push({ label: companyName || 'Nuvho Pty Ltd', id: 'doc-section-nuvho' })
  if (visible.showFees)       items.push({ label: 'Fee Structure', id: 'doc-section-fees' })
  if (visible.showAppendix)   items.push({ label: 'Terms & Conditions', id: 'doc-section-appendix' })
  return items
}

// NUVCL-125: derive a first name from the single Contact Name field captured
// on Hotel Details, for the salutation ("Dear <First Name>," instead of the
// full name). A true separate First Name / Surname capture would need a
// wizard + schema change (flagged on the ticket) — this is the lower-risk
// interim approach: take the first whitespace-delimited token of whatever's
// captured today.
function getFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || ''
}

// NUVCL-124: "Business Number" shown top-right of the letterhead, replacing
// the dropped sign-off footer block below. The first line of footerText is
// the legal entity/registration line (e.g. "Nuvho Pty Ltd - ABN 62 622 629
// 672") — the same text the removed doc-letter-footer used to show under
// the sign-off; the rest of footerText (if any further lines) is dropped
// here per Jude's "easiest solution" simplification. The fuller
// doc-legal-footer block near the Appendix is untouched.
function getBusinessNumberLine(footerText: string): string {
  return (footerText || '').split('\n')[0]?.trim() || ''
}

export function ProposalDocument({ model, beforeAppendix, pageBreakEditable, onTogglePageBreak }: {
  model: ProposalDocModel
  // Rendered inside .doc-flow immediately before the Terms & Conditions /
  // Appendix section (or at the end of .doc-flow if there's no Appendix to
  // show). Used by the public sign page to place its interactive Accept &
  // Sign form directly above Terms & Conditions instead of below the whole
  // document. Callers that pass interactive form content should give it a
  // "no-print" class (see globals.css) so it doesn't appear in the PDF —
  // ProposalDocument itself doesn't assume one way or the other.
  beforeAppendix?: React.ReactNode
  // NUVCL-132: when true, each category heading (Background, Scope of
  // Works, the company-name section, Fee Structure, Terms & Conditions)
  // shows an inline "Page Break" checkbox at its right — only the wizard's
  // Step7Preview passes this (with onTogglePageBreak wired to draft.terms.
  // pageBreaks); the internal Proposal Details page and the public sign
  // page render the document read-only and never set it, so the checkbox
  // never appears outside the wizard and never prints (it also carries
  // .no-print as a second line of defense).
  pageBreakEditable?: boolean
  onTogglePageBreak?: (sectionKey: string, checked: boolean) => void
}) {
  const multiSvc = model.services.length > 1
  // A step that was skipped (left with no usable content) drops both its
  // Table of Contents entry and its own page below — an empty "Scope of
  // Works" page with just a placeholder sentence isn't useful in a
  // client-facing document. "Nuvho Pty Ltd" is deliberately always shown:
  // it has no Skip button of its own (About Nuvho is auto-filled from
  // Region/Entity Settings, not a wizard step).
  // Background, Scope of Works, and Fee Structure all key off the same
  // "was the Services step skipped" check, so all three links/pages
  // disappear together rather than Fee Structure having its own separate
  // "no fee rows yet" condition.
  const showServices    = model.services.length > 0
  const showBackground = showServices
  const showScope       = showServices
  const showFees         = showServices
  // Hides when EITHER Services was skipped OR the resolved entity has no
  // clauses configured — both are independent reasons for there being
  // nothing to show.
  const showAppendix     = showServices && model.clauses.length > 0
  const tocItems = buildTocItems(model.companyName, { showBackground, showScope, showFees, showAppendix })

  // "Page Break" checkboxes from the wizard's Preview & Save step
  // (Step7Preview) — forces the section onto a fresh sheet in the
  // generated PDF via the .doc-section--break rule in globals.css's
  // @media print block. The inline page-grouping IIFE further down in
  // this component's JSX reads this same model.pageBreaks map to also
  // start a brand new on-screen .doc-flow "page" card at the same point,
  // so checking the box now has a visible effect in the preview too (it
  // used to be print-only).
  function breakClass(sectionKey: string): string {
    return model.pageBreaks?.[sectionKey] ? ' doc-section--break' : ''
  }

  // NUVCL-132: the heading row for each "Page Break"-able category — the
  // checkbox only renders in the wizard (pageBreakEditable), sitting to the
  // right of the heading, on the same border-bottom rule the heading alone
  // used to draw. Replaces the earlier separate "Page Breaks" panel above
  // the whole document preview, per Odysseus's reference image.
  function SectionHeading({ text, sectionKey }: { text: string; sectionKey: string }) {
    return (
      <div className="doc-heading-row">
        <h3 className="doc-heading">{text}</h3>
        {pageBreakEditable && (
          <label className="doc-pagebreak-toggle no-print">
            <input
              type="checkbox"
              checked={!!model.pageBreaks?.[sectionKey]}
              onChange={e => onTogglePageBreak?.(sectionKey, e.target.checked)}
            />
            <span className="doc-pagebreak-toggle__label">Page Break</span>
          </label>
        )}
      </div>
    )
  }

  function jumpTo(e: React.MouseEvent, id: string) {
    e.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }


  // NUVCL-119: four branded A4 cover layouts (from Odysseus's "A4 cover page
  // templates" design export), selected in the wizard's Cover Image step and
  // stored as a `branded:<id>` sentinel in the existing coverUrl field — see
  // BRANDED_COVER_TEMPLATES in app/(app)/proposals/new/page.tsx. Any other
  // coverUrl value (a real image URL, or empty) renders the original photo
  // cover unchanged below, so existing proposals are unaffected.
  const { template: brandedTemplate, photoUrl: brandedPhotoUrl } = parseCoverUrl(model.coverUrl || '')

  return (
    <div className="doc-preview" id="proposal-print-root">
      {/* Cover — NUVCL-102: full-bleed A4 image. The "Nuvho PTY LTD" wordmark
          and a "Date of Issue" label were never actually rendered here (both
          already live on the Letter page below); the date VALUE that was
          shown on the cover is removed per the ticket so the cover is pure
          branding/title, with the print-only full-page sizing handled in
          globals.css. */}
      {brandedTemplate === 'circles' && (
        <div className="doc-page doc-cover doc-cover--circles">
          <span className="doc-cover-circles__arc" />
          <div className="doc-cover-circles__top">
            <NuvhoLogo variant="white" height={36} />
          </div>
          <div className="doc-cover-circles__body">
            <div className="doc-cover-circles__category">{model.title || 'Proposal'}</div>
            <div className="doc-cover-circles__heading">{model.hotelName || '[Property Name]'}</div>
            <div className="doc-cover-circles__meta">
              <span>Issued</span>
              <strong>{model.dateIssued}</strong>
            </div>
          </div>
          <div className="doc-cover-circles__footer">nuvho.com</div>
        </div>
      )}

      {brandedTemplate === 'split' && (
        <div className="doc-page doc-cover doc-cover--split">
          <div
            className="doc-cover-split__hero"
            style={brandedPhotoUrl ? { backgroundImage: `url(${brandedPhotoUrl})` } : undefined}
          >
            <div className="doc-cover-split__hero-scrim">
              <NuvhoLogo variant="white" height={38} />
            </div>
            {!brandedPhotoUrl && <span className="doc-cover-split__hero-placeholder" />}
          </div>
          <div className="doc-cover-split__content">
            <div className="doc-cover-split__category">{model.title || 'Proposal'}</div>
            <div className="doc-cover-split__heading">{model.hotelName || '[Property Name]'}</div>
            <div className="doc-cover-split__divider" />
            <div className="doc-cover-split__meta">
              <span>Issued</span>
              <strong>{model.dateIssued}</strong>
            </div>
          </div>
          <div className="doc-cover-split__footer">
            <span className="doc-cover-split__footer-stripe" />
            <div className="doc-cover-split__footer-inner">
              <NuvhoIconMark variant="white" size={22} />
              <span className="doc-cover-split__footer-brand">nuvho.com</span>
            </div>
          </div>
        </div>
      )}

      {brandedTemplate === 'editorial' && (
        <div className="doc-page doc-cover doc-cover--editorial">
          <div className="doc-cover-editorial__spine" />
          <div className="doc-cover-editorial__body">
            <NuvhoLogo variant="primary" height={70} />
            <div className="doc-cover-editorial__title">{model.title}</div>
            <div className="doc-cover-editorial__hotel">{model.hotelName || '[Property Name]'}</div>
            {tocItems.length > 0 && (
              <ul className="doc-cover-editorial__toc">
                {tocItems.map(item => <li key={item.id}>{item.label}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {brandedTemplate === 'sidebar' && (
        <div className="doc-page doc-cover doc-cover--sidebar">
          <div className="doc-cover-sidebar__rail">
            <NuvhoLogo variant="white" height={80} />
            <span className="doc-cover-sidebar__badge">Confidential</span>
          </div>
          <div className="doc-cover-sidebar__main">
            <div className="doc-cover-editorial__title">{model.title}</div>
            <div className="doc-cover-editorial__hotel">{model.hotelName || '[Property Name]'}</div>
          </div>
        </div>
      )}

      {!brandedTemplate && (
        <div className="doc-page doc-cover"
          style={model.coverUrl ? ({ '--doc-cover-url': `url(${model.coverUrl})` } as React.CSSProperties) : undefined}>
          <div className="doc-cover__scrim">
            <NuvhoLogo variant="white" height={120} />
            <div className="doc-cover__title">{model.title}</div>
            <div className="doc-cover__hotel">{model.hotelName || '[Property Name]'}</div>
          </div>
        </div>
      )}

      {/* Letter — always its own printed page (page 2, right after the cover);
          see the .doc-letter print rule in globals.css for the forced
          page-break-after that keeps Background/Scope of Works etc. from
          flowing up onto the same sheet as the signature. */}
      <div className="doc-page doc-letter">
        <div className="doc-letterhead">
          <div className="doc-letterhead__logo">
            {/* NUVCL-100: was height=96, oversized relative to the address
                block next to it (11.5px text) — brought down to a
                proportionate letterhead size. */}
            <NuvhoLogo height={56} />
          </div>
          <div className="doc-nuvho-address">
            {model.nuvhoAddress && model.nuvhoAddress.split('\n').map((line, i) => <React.Fragment key={i}>{line}<br /></React.Fragment>)}
            <div className="doc-date">{model.dateIssued}</div>
          </div>
        </div>
        {/* NUVCL-103: title/email/phone were captured on Step 1 and shown to
            staff on the Proposal Details sidebar, but were dropped from the
            generated document entirely — added here. */}
        <div className="doc-address">
          {model.contactName || '[Client Name]'}
          {model.contactTitle && <>, {model.contactTitle}</>}<br />
          {model.hotelName || '[Property Name]'}<br />
          {model.propertyAddress || '[Property Address]'}
          {(model.contactEmail || model.contactPhone) && <>
            <br />
            {model.contactEmail}{model.contactEmail && model.contactPhone && ' · '}{model.contactPhone}
          </>}
        </div>
        <div className="doc-re">RE: {model.title}</div>
        <p className="doc-salutation">Dear {getFirstName(model.contactName) || '[Client Name]'},</p>
        {/* introMessage is authored via the rich-text editor on wizard Step 1 (since NUVCL-118) — always HTML */}
        <div className="doc-rich-text" dangerouslySetInnerHTML={{ __html: model.introMessage }} />

        <div className="doc-toc">
          {tocItems.map(item => (
            <a key={item.id} href={`#${item.id}`} className="doc-toc__item"
              onClick={e => jumpTo(e, item.id)}>
              {item.label}
            </a>
          ))}
        </div>

        <p>If you require further information or wish to discuss this proposal, please don&apos;t hesitate to contact me.</p>
        <p>Yours sincerely,</p>
        {model.signatureRequired && (
          <div className="doc-signature__mark">
            {model.signatureMethod === 'draw'
              ? (model.signatureDataUrl
                  ? <img src={model.signatureDataUrl} alt="Signature" className="doc-signature__img" />
                  : <span className="doc-empty">Signature not yet captured</span>)
              : (model.signatoryName
                  ? <span className="doc-signature__script">{model.signatoryName}</span>
                  : <span className="doc-empty">Signature not yet captured</span>)}
          </div>
        )}
        <div className="doc-sender">
          <strong>{model.senderName || '[Sender Name]'}</strong><br />
          {model.senderRoleLabel || '[Sending team member not yet selected]'}
          {model.senderEmail && <><br />e: {model.senderEmail}</>}
        </div>
        {/* NUVCL-131: Business Number moved from the letterhead top-right
            (NUVCL-124) down to directly below the sign-off, separated by a
            horizontal rule, per Odysseus's reference image. */}
        {getBusinessNumberLine(model.footerText) && (
          <>
            <hr className="doc-signature-hr" />
            <div className="doc-business-number">{getBusinessNumberLine(model.footerText)}</div>
          </>
        )}
      </div>

      {/* Background through Appendix — grouped into on-screen "page" cards
          by renderFlowPages() above wherever a "Page Break" box is
          checked; see that function's own comment for the full
          explanation. */}
      {/* Background through Appendix are grouped into on-screen "page"
          cards wherever a "Page Break" box is checked, instead of always
          sharing the single .doc-flow card NUVCL-120 introduced. Each
          group renders as its own .doc-flow — the same white / shadowed /
          A4-sized card the cover and letter pages already use — so
          checking the box now visibly starts a brand new page right here
          (and anywhere else this component renders, e.g. the public sign
          page). With no boxes checked, every section lands in one group
          and renders exactly as before — a single continuous .doc-flow
          sheet. Each section still carries its own breakClass()/
          page-break-before for print — the PDF pagination is unchanged.

          IMPORTANT: this MUST stay an inline IIFE embedded directly in
          this JSX return statement, not a separately-declared function
          called from here. styled-jsx's babel transform only auto-scopes
          JSX literals it can see lexically inside the tree of THIS
          component's own return statement — it does not reach into a
          separately-declared function invoked via a call/JSX tag (see
          the NUVCL-141 comment on SectionHeading below for the same
          limitation). A prior version of this exact fix hoisted this
          logic into a standalone `function renderFlowPages()` called as
          `{renderFlowPages()}` — every non-:global() rule below
          (.doc-flow, .doc-section, .doc-bullet, .doc-fee-table, etc.)
          silently stopped applying anywhere this component renders,
          including the public client sign page, because none of those
          class names were ever actually attached to the DOM. Do not
          repeat that mistake — keep this logic inline right here, or if
          it must move into its own function, mark every CSS rule below
          it uses as :global() the same way doc-heading-row/doc-heading/
          doc-pagebreak-toggle already are. */}
      {(() => {
      type FlowItem = { key: string; breakBefore: boolean; node: React.ReactNode }
      const items: FlowItem[] = []

      if (showBackground) {
        items.push({
          key: 'background',
          breakBefore: !!model.pageBreaks?.background,
          node: (
            <div className={`doc-section${breakClass('background')}`} id="doc-section-background">
              <SectionHeading text="Background" sectionKey="background" />
              <p>
                {model.hotelName || 'The property'} has engaged Nuvho to deliver {model.title.toLowerCase()}, with a
                strong focus on maximising commercial performance and elevating the guest experience. This proposal
                outlines our recommended scope of works, fee structure and terms of engagement.
              </p>
            </div>
          ),
        })
      }

      if (showScope) {
        items.push({
          key: 'scope',
          breakBefore: !!model.pageBreaks?.scope,
          node: (
            <div className={`doc-section${breakClass('scope')}`} id="doc-section-scope">
              <SectionHeading text="Scope of Works" sectionKey="scope" />
              <p>
                We develop a long-term and collaborative partnership with our clients, delivering services and value
                across the spectrum of hotel operations.
              </p>
              {model.services.map(s => {
                let lastSection: string | null = null
                return (
                  <div key={s.code} className="doc-service-block">
                    {multiSvc && <h4 className="doc-subheading">{s.label}</h4>}
                    {s.scopeItems.filter(it => it.enabled).map(it => {
                      const showHeading = it.sectionHeading !== lastSection
                      lastSection = it.sectionHeading
                      return (
                        <React.Fragment key={it.id}>
                          {showHeading && <h5 className="doc-subheading2">{it.sectionHeading}</h5>}
                          <div className="doc-bullet">{it.text || '—'}</div>
                        </React.Fragment>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          ),
        })
      }

      items.push({
        key: 'nuvho',
        breakBefore: !!model.pageBreaks?.nuvho,
        node: (
          <div className={`doc-section${breakClass('nuvho')}`} id="doc-section-nuvho">
            <SectionHeading text={model.companyName || 'Nuvho Pty Ltd'} sectionKey="nuvho" />
            <p>
              {model.aboutNuvho || (
                'Nuvho is a new breed of hotel services company, providing tailored solutions to clients from a ' +
                'services, systems and operational perspective. We partner with independent and boutique hotels to ' +
                'deliver the commercial capability of a larger group, without the overhead.'
              )}
            </p>
          </div>
        ),
      })

      if (showFees) {
        items.push({
          key: 'fees',
          breakBefore: !!model.pageBreaks?.fees,
          node: (
            <div className={`doc-section${breakClass('fees')}`} id="doc-section-fees">
              <SectionHeading text="Fee Structure" sectionKey="fees" />
              <p>
                The following table outlines the associated fee structure of our services. Our fees exclude GST, which
                will be charged in addition where applicable.
              </p>
              <table className="doc-fee-table">
                <thead>
                  <tr><th>Component</th><th>Fee Type</th><th>Amount</th><th>Months</th><th>Note</th></tr>
                </thead>
                <tbody>
                  {model.services.map(s => (
                    <React.Fragment key={s.code}>
                      {multiSvc && (
                        <tr className="doc-fee-table__group"><td colSpan={5}>{s.label}</td></tr>
                      )}
                      {s.feeRows.map(row => (
                        <tr key={row.id}>
                          <td>{row.component || '—'}</td>
                          <td>{FEE_TYPES.find(f => f.value === row.feeType)?.label || row.feeType}</td>
                          <td>{row.fee === '' ? '—' : `${model.currencySymbol}${Number(row.fee).toLocaleString()}`}</td>
                          <td>{row.term === '' ? '—' : row.term}</td>
                          <td>{row.note || ''}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
              {model.grandTotalMonthly > 0 && (
                <div className="doc-fee-total">Combined monthly total: {model.currencySymbol}{model.grandTotalMonthly.toLocaleString()}</div>
              )}
              {model.footnotes.length > 0 && (
                <div className="doc-footnotes">
                  {model.footnotes.map(f => <div key={f.id} className="doc-bullet">{f.text}</div>)}
                </div>
              )}
            </div>
          ),
        })
      }

      if (beforeAppendix) {
        items.push({ key: 'beforeAppendix', breakBefore: false, node: beforeAppendix })
      }

      if (showAppendix) {
        items.push({
          key: 'appendix',
          breakBefore: !!model.pageBreaks?.appendix,
          node: (
            <div className={`doc-section${breakClass('appendix')}`} id="doc-section-appendix">
              {model.clientSignedAt && (
                <div className="doc-client-acceptance">
                  <h4 className="doc-subheading">Client Acceptance</h4>
                  <div className="doc-signature__mark">
                    {model.clientSignatureMethod === 'draw'
                      ? (model.clientSignatureDataUrl
                          ? <img src={model.clientSignatureDataUrl} alt="Client signature" className="doc-signature__img" />
                          : <span className="doc-empty">Signature not captured</span>)
                      : (model.clientSignatoryName
                          ? <span className="doc-signature__script">{model.clientSignatoryName}</span>
                          : <span className="doc-empty">Signature not captured</span>)}
                  </div>
                  <div className="doc-client-acceptance__meta">
                    <strong>{model.clientSignatoryName || '[Client Name]'}</strong>
                    {model.clientSignatoryTitle && <>, {model.clientSignatoryTitle}</>}<br />
                    Signed {model.clientSignedAt}
                  </div>
                </div>
              )}
              <SectionHeading text="Terms & Conditions" sectionKey="appendix" />
              {model.clauses.map(c => (
                <div key={c.id} className="doc-clause">
                  <h5 className="doc-subheading2">{c.heading}</h5>
                  <p>{c.text}</p>
                </div>
              ))}
            </div>
          ),
        })
      }

      // Group into pages: a new page card starts right before any item whose
      // own "Page Break" box is checked (the very first item never starts a
      // fresh one — it's already at the top of the first page in this flow).
      const pages: React.ReactNode[][] = []
      let current: React.ReactNode[] = []
      items.forEach((item, idx) => {
        if (idx > 0 && item.breakBefore) {
          pages.push(current)
          current = []
        }
        current.push(<React.Fragment key={item.key}>{item.node}</React.Fragment>)
      })
      if (current.length > 0) pages.push(current)

      return pages.map((page, i) => (
        <div className="doc-flow" key={i}>{page}</div>
      ))
      })()}

      <style jsx>{`
        /* NUVCL-132: .doc-page/.doc-flow are sized to real A4 width (210mm)
           with the same 15mm/14mm padding the print stylesheet uses (see
           globals.css's @media print), instead of an arbitrary 680px "web
           card" — so the Preview & Save step (and everywhere else this
           renders) shows line-wrapping and margins that actually match the
           generated PDF, not just a same-content-different-shape preview.
           Each .doc-page/.doc-flow card gets a generous 28px gap below it
           (bumped up from 18px) so a stack of these cards — cover, letter,
           and now every "Page Break"-separated .doc-flow group from the
           page-grouping logic in the main return statement — reads
           unambiguously as separate physical
           pages, matching the client-facing document, rather than looking
           like a single sheet with an odd seam partway down it. */
        .doc-preview { background: var(--nv-surface-page); padding: 24px 0; border-radius: 12px; overflow-x: auto; }
        .doc-page {
          background: white; width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto 28px; padding: 15mm 14mm;
          border-radius: 4px; box-shadow: var(--nv-shadow-sm); font-family: var(--font-raleway);
          font-size: 13px; line-height: 1.7; color: var(--nv-text-body); box-sizing: border-box;
        }
        .doc-page p { margin-bottom: 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        /* NUVCL-120: Background..Appendix render inside .doc-flow cards
           (instead of one .doc-page card each) so sections with no "Page
           Break" checked between them still share a single continuous
           sheet, matching what actually prints — no per-section shadow/
           rounded-corner "card" that the real PDF never had. .doc-section
           is just a content block inside its .doc-flow card, with only
           enough margin to visually separate it from the next one. A
           checked "Page Break" starts a whole new .doc-flow card instead
           (see the page-grouping IIFE in the return statement below)
           rather than just adding a class
           with no on-screen effect. */
        :global(.doc-flow) {
          background: white; width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto 28px; padding: 15mm 14mm;
          border-radius: 4px; box-shadow: var(--nv-shadow-sm); font-family: var(--font-raleway);
          font-size: 13px; line-height: 1.7; color: var(--nv-text-body); box-sizing: border-box;
        }
        :global(.doc-flow p) { margin-bottom: 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        :global(.doc-section) { margin-bottom: 32px; }
        :global(.doc-section):last-child { margin-bottom: 0; }
        .doc-cover {
          position: relative;
          height: 297mm; background-image: var(--doc-cover-url, none); background-size: cover; background-position: center;
          background-color: var(--nv-blue-slate); display: flex; align-items: flex-end; padding: 0;
          /* Clip the scrim overlay (below) to this box's own border-radius —
             otherwise its square corners sit flush on top of the rounded
             bottom edge, so only the top corners look rounded. */
          overflow: hidden;
        }
        .doc-cover__scrim {
          width: 100%; background: linear-gradient(to top, rgba(20,40,50,0.78), rgba(20,40,50,0));
          padding: 32px 48px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
        }
        .doc-cover__title { font-family: var(--font-comfortaa); color: white; font-size: 22px; font-weight: 700; margin-top: 14px; }
        .doc-cover__hotel { color: rgba(255,255,255,0.92); font-size: 14px; }
        .doc-cover__date  { color: rgba(255,255,255,0.7); font-size: 12px; }

        /* NUVCL-119 — branded cover templates (redrawn to match the client's
           reference mockups: a solid dark cover with a decorative arc and a
           vertically-centred hotel name, and a photo-hero cover with a
           branding footer bar). */
        /* Padding lives on the child rows (top/body/footer) below, not on
           .doc-cover--circles itself — the print stylesheet's higher-
           specificity #proposal-print-root .doc-cover rule (globals.css,
           padding: 0) zeroes out any padding set on this container in the
           actual PDF, which is what left the logo/heading pinned flush to
           the page edges there even though the on-screen preview looked
           fine. Descendant elements aren't touched by that override. */
        .doc-cover--circles {
          background-image: none; background-color: var(--nv-blue-slate);
          flex-direction: column; align-items: stretch;
          padding: 0; position: relative; overflow: hidden;
        }
        .doc-cover-circles__arc {
          position: absolute; left: -220px; bottom: -220px; width: 520px; height: 520px;
          border: 1px solid rgba(255,255,255,0.22); border-radius: 50%; pointer-events: none;
        }
        .doc-cover-circles__top { display: flex; align-items: center; z-index: 1; padding: 40px 44px 0; }
        /* flex: 1 + its own justify-content: center vertically centres the
           category/heading/issued group in the space between the logo row
           and the footer, rather than pinning it to the bottom. */
        .doc-cover-circles__body { flex: 1; display: flex; flex-direction: column; justify-content: center; z-index: 1; padding: 0 44px; }
        .doc-cover-circles__category {
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--nv-steel-blue); margin-bottom: 10px;
        }
        .doc-cover-circles__heading { font-family: var(--font-comfortaa); color: white; font-size: 30px; font-weight: 700; line-height: 1.15; }
        .doc-cover-circles__meta {
          display: flex; gap: 6px; margin-top: 18px; font-size: 10.5px; color: rgba(255,255,255,0.65);
          text-transform: uppercase; letter-spacing: 0.08em;
        }
        .doc-cover-circles__meta strong { color: rgba(255,255,255,0.95); text-transform: none; letter-spacing: 0; font-size: 12px; }
        .doc-cover-circles__footer { z-index: 1; font-size: 11px; color: rgba(255,255,255,0.5); padding: 0 44px 40px; }

        /* Hero/content used to split 58%/30% of .doc-cover's total height,
           tuned for the old on-screen preview's arbitrary 460px cover box.
           Now that .doc-cover is a true A4 sheet (297mm ~= 1122px) on
           screen too (see .doc-cover's height rule above), those same
           percentages blow the content panel (and the divider inside it)
           up to ~370px of empty cream space around a few lines of text
           instead of a compact caption bar under the photo -- the "broken
           divider" complaint. Fixed by making content/footer size to their
           own content (flex: 0 0 auto) and letting hero (the photo, which
           only benefits from more room) absorb 100% of whatever height is
           left over, at any total cover height. */
        .doc-cover--split { background-image: none; background-color: transparent; flex-direction: column; align-items: stretch; padding: 0; }
        .doc-cover-split__hero {
          flex: 1 1 auto; position: relative; background-color: var(--nv-platinum);
          background-size: cover; background-position: center; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        .doc-cover-split__hero-scrim {
          position: absolute; top: 0; left: 0; right: 0; padding: 22px 26px;
          display: flex; align-items: center; justify-content: space-between;
          background: linear-gradient(to bottom, rgba(20,40,50,0.55), rgba(20,40,50,0));
        }
        .doc-cover-split__hero-placeholder { width: 30px; height: 30px; border: 1.5px dashed var(--nv-border); border-radius: 4px; }
        .doc-cover-split__content { flex: 0 0 auto; padding: 28px 28px 24px; background: #EEF3F5; display: flex; flex-direction: column; justify-content: center; }
        .doc-cover-split__category { font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--nv-steel-blue); font-weight: 700; margin-bottom: 8px; }
        .doc-cover-split__heading { font-family: var(--font-comfortaa); font-size: 25px; font-weight: 700; color: var(--nv-blue-slate); margin-bottom: 18px; }
        .doc-cover-split__divider { height: 1px; background: var(--nv-border-hair); margin-bottom: 12px; }
        .doc-cover-split__meta { display: flex; gap: 6px; font-size: 10.5px; color: var(--nv-text-muted); text-transform: uppercase; letter-spacing: 0.08em; }
        .doc-cover-split__meta strong { color: var(--nv-blue-slate); text-transform: none; letter-spacing: 0; font-size: 12px; }
        .doc-cover-split__footer { height: 46px; flex-shrink: 0; background: #1A3D4A; position: relative; overflow: hidden; }
        .doc-cover-split__footer-stripe {
          position: absolute; top: 0; bottom: 0; left: 38%; width: 70px; z-index: 0;
          background: rgba(255,255,255,0.08); transform: skewX(-22deg); pointer-events: none;
        }
        .doc-cover-split__footer-inner {
          position: relative; z-index: 1; height: 100%;
          display: flex; align-items: center; gap: 10px; padding: 0 26px;
        }
        .doc-cover-split__footer-brand { font-size: 11px; letter-spacing: 0.06em; color: rgba(255,255,255,0.85); margin-left: auto; }

        .doc-cover--editorial { background-image: none; background-color: white; display: flex; align-items: stretch; padding: 0; }
        .doc-cover-editorial__spine { width: 14px; flex-shrink: 0; background: var(--nv-blue-slate); }
        .doc-cover-editorial__body { flex: 1; padding: 48px; display: flex; flex-direction: column; gap: 6px; }
        .doc-cover-editorial__title { font-family: var(--font-comfortaa); color: var(--nv-blue-slate); font-size: 22px; font-weight: 700; margin-top: 14px; }
        .doc-cover-editorial__hotel { color: var(--nv-text-body); font-size: 14px; }
        .doc-cover-editorial__toc {
          margin: 24px 0 0; padding: 16px 0 0; border-top: 1px solid var(--nv-border-hair);
          list-style: none; display: flex; flex-direction: column; gap: 8px;
          font-size: 13px; color: var(--nv-text-body);
        }

        .doc-cover--sidebar { background-image: none; background-color: white; display: flex; align-items: stretch; padding: 0; }
        .doc-cover-sidebar__rail {
          width: 34%; flex-shrink: 0; background: #1A3D4A; padding: 40px 28px;
          display: flex; flex-direction: column; justify-content: space-between;
        }
        .doc-cover-sidebar__badge {
          align-self: flex-start; font-family: var(--font-comfortaa); font-size: 10px;
          letter-spacing: 0.12em; text-transform: uppercase; color: var(--nv-blue-slate);
          background: var(--nv-platinum); border-radius: 999px; padding: 6px 14px;
        }
        .doc-cover-sidebar__main { flex: 1; padding: 48px; display: flex; flex-direction: column; justify-content: center; gap: 6px; }

        .doc-letterhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 16px; }
        .doc-letterhead__logo { flex-shrink: 0; }
        .doc-date    { font-size: 12px; color: var(--nv-text-muted); margin-top: 6px; }
        .doc-nuvho-address { font-size: 11.5px; color: var(--nv-text-muted); text-align: right; line-height: 1.5; }
        /* NUVCL-132: centered — this is now the ONLY place this text
           renders in the whole document (the duplicate near Fee Structure/
           Appendix, .doc-legal-footer, has been removed entirely). */
        .doc-business-number { margin-top: 6px; font-size: 10.5px; color: var(--nv-text-muted); text-align: center; }
        .doc-signature-hr { border: none; border-top: 1px solid var(--nv-border-hair); margin: 18px 0 8px; } /* NUVCL-131 */
        .doc-address { margin-bottom: 48px; } /* NUVCL-124: more spacing below client address */
        .doc-re      { font-weight: 700; margin-bottom: 22px; } /* NUVCL-124: more spacing below reference */
        .doc-salutation { margin-bottom: 20px; } /* NUVCL-124: single line space below "Dear xxx," */
        .doc-toc     { margin: 18px 0; padding-left: 4px; }
        .doc-toc__item {
          display: block; padding: 4px 0; font-weight: 600; color: var(--nv-text-heading);
          text-decoration: none; cursor: pointer; transition: color var(--nv-dur);
        }
        .doc-toc__item:hover, .doc-toc__item:focus-visible { color: var(--nv-blue-slate); text-decoration: underline; }
        .doc-sender  { margin-top: 4px; }

        /* NUVCL-132: the border/spacing that used to live on .doc-heading
           itself now lives on the row wrapping it, so an inline "Page
           Break" checkbox can sit at the right of the same heading without
           the border only running under the heading text. */
        /* NUVCL-141: SectionHeading is a nested function INSIDE this
           component, but it's invoked as <SectionHeading .../> -- a real,
           separate React component render as far as styled-jsx's babel
           transform is concerned. Styled-jsx only auto-tags literal JSX
           elements written directly in the tree of the function that
           contains this <style jsx> block; it does not, and cannot, reach
           into a child component's own returned elements (SectionHeading
           never receives or forwards a className prop). That's why every
           previous fix to .doc-heading-row/.doc-pagebreak-toggle here was
           correct in source yet never visibly applied in the browser --
           the scoped selectors literally never matched those DOM nodes.
           :global() opts these specific rules out of scoping so they match
           on class name alone, regardless of which function rendered the
           element. */
        :global(.doc-heading-row) {
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--nv-border-hair);
        }
        :global(.doc-heading) {
          font-family: var(--font-comfortaa); font-size: 16px; font-weight: 700; color: var(--nv-text-heading);
        }
        :global(.doc-pagebreak-toggle) {
          display: flex; align-items: center; gap: 8px; flex-shrink: 0;
          font-family: var(--font-raleway); font-size: 11px; font-weight: 600; color: var(--nv-text-muted);
          white-space: nowrap; cursor: pointer;
        }
        /* Space between the checkbox and its "Page Break" label is set two
           ways on purpose: flex gap on the row above AND a direct
           margin-right on the input itself. Belt-and-braces -- margin-right
           alone guarantees the visible gap regardless of how a given
           browser treats gap next to a bare JSX text/span node. */
        :global(.doc-pagebreak-toggle input) { width: 15px; height: 15px; margin: 0 6px 0 0; cursor: pointer; }
        :global(.doc-pagebreak-toggle__label) { margin-left: 2px; }
        :global(.doc-subheading)  { font-family: var(--font-comfortaa); font-size: 13px; font-weight: 700; margin: 16px 0 8px; color: var(--nv-blue-slate); }
        :global(.doc-subheading2) { font-size: 12px; font-weight: 700; margin: 12px 0 6px; }
        :global(.doc-bullet) { position: relative; padding-left: 14px; margin-bottom: 6px; font-size: 12.5px; }
        :global(.doc-bullet)::before { content: '•'; position: absolute; left: 0; color: var(--nv-blue-slate); }
        :global(.doc-service-block) { margin-bottom: 8px; }
        :global(.doc-empty) { color: var(--nv-text-muted); font-style: italic; }

        :global(.doc-fee-table) { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
        :global(.doc-fee-table th) { text-align: left; background: var(--nv-blue-slate); color: white; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        :global(.doc-fee-table td) { padding: 6px 8px; border-bottom: 1px solid var(--nv-border-hair); }
        :global(.doc-fee-table__group td) { background: var(--nv-platinum); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        :global(.doc-fee-total) { text-align: right; margin-top: 10px; font-weight: 700; color: var(--nv-blue-slate); }
        :global(.doc-footnotes) { margin-top: 12px; } /* NUVCL-132: item styling now comes from .doc-bullet, matching Scope of Works */

        .doc-rich-text :global(p) { margin: 0 0 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        .doc-rich-text :global(ul), .doc-rich-text :global(ol) { margin: 0 0 10px 20px; }
        :global(.doc-signature__mark) { padding-bottom: 8px; min-height: 60px; display: flex; align-items: flex-end; margin-top: 10px; }
        :global(.doc-signature__script) { font-family: var(--font-signature); font-size: 36px; color: var(--nv-text-heading); }
        :global(.doc-signature__img) { max-height: 80px; }

        :global(.doc-clause) { margin-bottom: 14px; }

        /* NUVCL-131: client's captured signature, printed at the top of
           Terms & Conditions once the proposal has been signed. */
        :global(.doc-client-acceptance) {
          margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--nv-border-hair);
        }
        :global(.doc-client-acceptance__meta) { font-size: 11.5px; color: var(--nv-text-muted); line-height: 1.5; }
      `}</style>
    </div>
  )
}
