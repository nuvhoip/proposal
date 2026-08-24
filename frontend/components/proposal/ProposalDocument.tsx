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

export function ProposalDocument({ model }: { model: ProposalDocModel }) {
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
            <div className="doc-cover-circles__heading">{model.hotelName || '[Hotel Name]'}</div>
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
            <div className="doc-cover-split__heading">{model.hotelName || '[Hotel Name]'}</div>
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
            <div className="doc-cover-editorial__hotel">{model.hotelName || '[Hotel Name]'}</div>
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
            <div className="doc-cover-editorial__hotel">{model.hotelName || '[Hotel Name]'}</div>
          </div>
        </div>
      )}

      {!brandedTemplate && (
        <div className="doc-page doc-cover"
          style={model.coverUrl ? ({ '--doc-cover-url': `url(${model.coverUrl})` } as React.CSSProperties) : undefined}>
          <div className="doc-cover__scrim">
            <NuvhoLogo variant="white" height={120} />
            <div className="doc-cover__title">{model.title}</div>
            <div className="doc-cover__hotel">{model.hotelName || '[Hotel Name]'}</div>
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
            {/* NUVCL-124: Business Number top-right, replacing the dropped
                letter footer below the sign-off. */}
            {getBusinessNumberLine(model.footerText) && (
              <div className="doc-business-number">{getBusinessNumberLine(model.footerText)}</div>
            )}
          </div>
        </div>
        {/* NUVCL-103: title/email/phone were captured on Step 1 and shown to
            staff on the Proposal Details sidebar, but were dropped from the
            generated document entirely — added here. */}
        <div className="doc-address">
          {model.contactName || '[Client Name]'}
          {model.contactTitle && <>, {model.contactTitle}</>}<br />
          {model.hotelName || '[Hotel Name]'}<br />
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
        {/* NUVCL-124 (2026-08-24): the letter sign-off footer block was
            dropped per Jude's decision — the Business Number now shows
            top-right of the letterhead instead (see above). The fuller
            doc-legal-footer block near the Appendix still renders lower in
            the document, unchanged. */}
      </div>

      {/* NUVCL-120: Background through Appendix now share ONE flowing
          container (.doc-flow) instead of each being its own separate
          .doc-page "card". This fixes two things at once: (1) on screen,
          the preview no longer shows a stack of separately-carded sections
          floating on a grey background — it's one continuous sheet, matching
          what the PDF actually renders; (2) in print, the 15mm page-margin
          padding (see globals.css) is now applied ONCE per physical page to
          the shared wrapper instead of once per SECTION, which is what
          caused the ~36mm blank gap whenever two short sections (e.g.
          Background and Scope of Works) landed on the same sheet — each
          section's own top+bottom padding plus its margin was stacking on
          top of the next section's padding. Individual sections below only
          need a small margin-bottom now for visual separation. */}
      <div className="doc-flow">
        {/* Background — hidden when Services (Step 2) was skipped, i.e.
            there's nothing to describe. */}
        {showBackground && (
          <div className="doc-section" id="doc-section-background">
            <h3 className="doc-heading">Background</h3>
            <p>
              {model.hotelName || 'The property'} has engaged Nuvho to deliver {model.title.toLowerCase()}, with a
              strong focus on maximising commercial performance and elevating the guest experience. This proposal
              outlines our recommended scope of works, fee structure and terms of engagement.
            </p>
          </div>
        )}

        {/* Scope of Works — hidden when Services (Step 2) was skipped. */}
        {showScope && (
          <div className="doc-section" id="doc-section-scope">
            <h3 className="doc-heading">Scope of Works</h3>
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
        )}

        {/* Nuvho Pty Ltd (Company Name + About — Settings → Region Settings) */}
        <div className="doc-section" id="doc-section-nuvho">
          <h3 className="doc-heading">{model.companyName || 'Nuvho Pty Ltd'}</h3>
          <p>
            {model.aboutNuvho || (
              'Nuvho is a new breed of hotel services company, providing tailored solutions to clients from a ' +
              'services, systems and operational perspective. We partner with independent and boutique hotels to ' +
              'deliver the commercial capability of a larger group, without the overhead.'
            )}
          </p>
        </div>

        {/* Fee Structure — hidden together with Background and Scope of Works
            whenever Services (Step 2) was skipped. */}
        {showFees && (
          <div className="doc-section" id="doc-section-fees">
            <h3 className="doc-heading">Fee Structure</h3>
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
              <ul className="doc-footnotes">
                {model.footnotes.map(f => <li key={f.id}>{f.text}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Quote Approval section removed — the sender's signature now lives
            in the letter above, and client acceptance happens via the public
            sign page's own checkbox/approval flow rather than this static
            statement. The legal footer is unrelated boilerplate (generic
            company-registration text), so it always renders as its own
            section below regardless. */}
        {model.footerText && (
          <div className="doc-section">
            <div className="doc-legal-footer">
              {model.footerText.split('\n').map((line, i) => <React.Fragment key={i}>{line}<br /></React.Fragment>)}
            </div>
          </div>
        )}

        {/* Appendix — Terms & Conditions — hidden when Services (Step 2) was
            skipped, or when the resolved entity has no clauses configured. */}
        {showAppendix && (
          <div className="doc-section" id="doc-section-appendix">
            <h3 className="doc-heading">Terms &amp; Conditions</h3>
            {model.clauses.map(c => (
              <div key={c.id} className="doc-clause">
                <h5 className="doc-subheading2">{c.heading}</h5>
                <p>{c.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .doc-preview { background: var(--nv-surface-page); padding: 24px 0; border-radius: 12px; }
        .doc-page {
          background: white; max-width: 680px; margin: 0 auto 18px; padding: 40px 48px;
          border-radius: 4px; box-shadow: var(--nv-shadow-sm); font-family: var(--font-raleway);
          font-size: 13px; line-height: 1.7; color: var(--nv-text-body);
        }
        .doc-page p { margin-bottom: 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        /* NUVCL-120: Background..Appendix render inside ONE .doc-flow card
           (instead of one .doc-page card each) so the on-screen preview is a
           single continuous sheet, matching what actually prints — no
           per-section shadow/rounded-corner "card" that the real PDF never
           had. .doc-section is just a content block inside that shared card,
           with only enough margin to visually separate it from the next one. */
        .doc-flow {
          background: white; max-width: 680px; margin: 0 auto 18px; padding: 40px 48px;
          border-radius: 4px; box-shadow: var(--nv-shadow-sm); font-family: var(--font-raleway);
          font-size: 13px; line-height: 1.7; color: var(--nv-text-body);
        }
        .doc-flow p { margin-bottom: 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        .doc-section { margin-bottom: 32px; }
        .doc-section:last-child { margin-bottom: 0; }
        .doc-cover {
          position: relative;
          height: 460px; background-image: var(--doc-cover-url, none); background-size: cover; background-position: center;
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

        .doc-cover--split { background-image: none; background-color: transparent; flex-direction: column; align-items: stretch; padding: 0; }
        .doc-cover-split__hero {
          flex: 1 1 58%; position: relative; background-color: var(--nv-platinum);
          background-size: cover; background-position: center; overflow: hidden;
          display: flex; align-items: center; justify-content: center;
        }
        .doc-cover-split__hero-scrim {
          position: absolute; top: 0; left: 0; right: 0; padding: 22px 26px;
          display: flex; align-items: center; justify-content: space-between;
          background: linear-gradient(to bottom, rgba(20,40,50,0.55), rgba(20,40,50,0));
        }
        .doc-cover-split__hero-placeholder { width: 30px; height: 30px; border: 1.5px dashed var(--nv-border); border-radius: 4px; }
        .doc-cover-split__content { flex: 1 1 30%; padding: 24px 28px 20px; background: #EEF3F5; display: flex; flex-direction: column; justify-content: center; }
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
        .doc-business-number { margin-top: 6px; font-size: 10.5px; color: var(--nv-text-muted); } /* NUVCL-124 */
        .doc-address { margin-bottom: 48px; } /* NUVCL-124: more spacing below client address */
        .doc-legal-footer {
          margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--nv-border-hair);
          font-size: 10.5px; line-height: 1.6; color: var(--nv-text-muted);
        }
        /* NUVCL-124 (2026-08-24): .doc-letter-footer removed with the block it styled — see doc-business-number above. */
        .doc-re      { font-weight: 700; margin-bottom: 22px; } /* NUVCL-124: more spacing below reference */
        .doc-salutation { margin-bottom: 20px; } /* NUVCL-124: single line space below "Dear xxx," */
        .doc-toc     { margin: 18px 0; padding-left: 4px; }
        .doc-toc__item {
          display: block; padding: 4px 0; font-weight: 600; color: var(--nv-text-heading);
          text-decoration: none; cursor: pointer; transition: color var(--nv-dur);
        }
        .doc-toc__item:hover, .doc-toc__item:focus-visible { color: var(--nv-blue-slate); text-decoration: underline; }
        .doc-sender  { margin-top: 4px; }

        .doc-heading {
          font-family: var(--font-comfortaa); font-size: 16px; font-weight: 700; color: var(--nv-text-heading);
          margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid var(--nv-border-hair);
        }
        .doc-subheading  { font-family: var(--font-comfortaa); font-size: 13px; font-weight: 700; margin: 16px 0 8px; color: var(--nv-blue-slate); }
        .doc-subheading2 { font-size: 12px; font-weight: 700; margin: 12px 0 6px; }
        .doc-bullet { position: relative; padding-left: 14px; margin-bottom: 6px; font-size: 12.5px; }
        .doc-bullet::before { content: '•'; position: absolute; left: 0; color: var(--nv-blue-slate); }
        .doc-service-block { margin-bottom: 8px; }
        .doc-empty { color: var(--nv-text-muted); font-style: italic; }

        .doc-fee-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
        .doc-fee-table th { text-align: left; background: var(--nv-blue-slate); color: white; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
        .doc-fee-table td { padding: 6px 8px; border-bottom: 1px solid var(--nv-border-hair); }
        .doc-fee-table__group td { background: var(--nv-platinum); font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .doc-fee-total { text-align: right; margin-top: 10px; font-weight: 700; color: var(--nv-blue-slate); }
        .doc-footnotes { margin-top: 12px; padding-left: 18px; font-size: 11px; color: var(--nv-text-muted); }

        .doc-rich-text :global(p) { margin: 0 0 18px; } /* NUVCL-124: single-line spacing after each paragraph */
        .doc-rich-text :global(ul), .doc-rich-text :global(ol) { margin: 0 0 10px 20px; }
        .doc-signature__mark { padding-bottom: 8px; min-height: 60px; display: flex; align-items: flex-end; margin-top: 10px; }
        .doc-signature__script { font-family: var(--font-signature); font-size: 36px; color: var(--nv-text-heading); }
        .doc-signature__img { max-height: 80px; }

        .doc-clause { margin-bottom: 14px; }
      `}</style>
    </div>
  )
}
