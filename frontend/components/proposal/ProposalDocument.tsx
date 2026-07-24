'use client'

import React from 'react'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'
import { FEE_TYPES } from '@/lib/serviceCatalog'
import type { ProposalDocModel } from '@/lib/documentModel'

/* Read-only rendering of a normalized ProposalDocModel in the same letter +
   section structure as Nuvho's Word proposal templates: cover, salutation
   letter with a table of contents, Background, Scope of Works (grouped per
   selected service), Nuvho Pty Ltd, Fee Structure, Quote Approval (signature),
   and an Appendix of Terms & Conditions.

   Shared by the wizard's Preview & Send step (built from the in-progress
   draft) and the Proposal Details page (built from a saved proposal) so the
   document layout — and its PDF/Word export — only exists in one place.
   The root element's id is the target for the print stylesheet used by the
   "Download PDF" button (see globals.css `@media print`). */
export function ProposalDocument({ model }: { model: ProposalDocModel }) {
  const multiSvc = model.services.length > 1

  return (
    <div className="doc-preview" id="proposal-print-root">
      {/* Cover */}
      <div className="doc-page doc-cover"
        style={model.coverUrl ? { backgroundImage: `url(${model.coverUrl})` } : undefined}>
        <div className="doc-cover__scrim">
          <NuvhoLogo variant="white" height={120} />
          <div className="doc-cover__title">{model.title}</div>
          <div className="doc-cover__hotel">{model.hotelName || '[Hotel Name]'}</div>
          <div className="doc-cover__date">{model.dateIssued}</div>
        </div>
      </div>

      {/* Letter */}
      <div className="doc-page">
        <div className="doc-date">Date of Issue: {model.dateIssued}</div>
        <div className="doc-address">
          {model.contactName || '[Client Name]'}<br />
          {model.hotelName || '[Hotel Name]'}<br />
          {model.propertyAddress || '[Property Address]'}
        </div>
        <div className="doc-re">RE: {model.title}</div>
        <p>Dear {model.contactName || '[Client Name]'},</p>
        <p>{model.introMessage}</p>

        <div className="doc-toc">
          <div className="doc-toc__item">Background</div>
          <div className="doc-toc__item">Scope of Works</div>
          <div className="doc-toc__item">Nuvho Pty Ltd</div>
          <div className="doc-toc__item">Fee Structure</div>
          <div className="doc-toc__item">Quote Approval</div>
          <div className="doc-toc__item">Appendix 1 – Terms &amp; Conditions</div>
        </div>

        <p>If you require further information or wish to discuss this proposal, please don&apos;t hesitate to contact me.</p>
        <p>Yours sincerely,</p>
        <div className="doc-sender">
          <strong>{model.senderName || '[Sender Name]'}</strong><br />
          {model.senderRoleLabel || '[Sending team member not yet selected]'}
          {model.senderEmail && <><br />e: {model.senderEmail}</>}
        </div>
      </div>

      {/* Background */}
      <div className="doc-page">
        <h3 className="doc-heading">Background</h3>
        <p>
          {model.hotelName || 'The property'} has engaged Nuvho to deliver {model.title.toLowerCase()}, with a
          strong focus on maximising commercial performance and elevating the guest experience. This proposal
          outlines our recommended scope of works, fee structure and terms of engagement.
        </p>
      </div>

      {/* Scope of Works */}
      <div className="doc-page">
        <h3 className="doc-heading">Scope of Works</h3>
        <p>
          We develop a long-term and collaborative partnership with our clients, delivering services and value
          across the spectrum of hotel operations.
        </p>
        {model.services.length === 0 && <p className="doc-empty">No services selected yet.</p>}
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

      {/* Nuvho Pty Ltd */}
      <div className="doc-page">
        <h3 className="doc-heading">Nuvho Pty Ltd</h3>
        <p>
          Nuvho is a new breed of hotel services company, providing tailored solutions to clients from a services,
          systems and operational perspective. We partner with independent and boutique hotels to deliver the
          commercial capability of a larger group, without the overhead.
        </p>
      </div>

      {/* Fee Structure */}
      <div className="doc-page">
        <h3 className="doc-heading">Fee Structure</h3>
        <p>
          The following table outlines the associated fee structure of our services. Our fees exclude GST, which
          will be charged in addition where applicable.
        </p>
        {model.services.length === 0 ? (
          <p className="doc-empty">No pricing configured yet.</p>
        ) : (
          <>
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
                        <td>{row.fee === '' ? '—' : `$${Number(row.fee).toLocaleString()}`}</td>
                        <td>{row.term === '' ? '—' : row.term}</td>
                        <td>{row.note || ''}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {model.grandTotalMonthly > 0 && (
              <div className="doc-fee-total">Combined monthly total: ${model.grandTotalMonthly.toLocaleString()}</div>
            )}
            {model.footnotes.length > 0 && (
              <ul className="doc-footnotes">
                {model.footnotes.map(f => <li key={f.id}>{f.text}</li>)}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Quote Approval */}
      <div className="doc-page">
        <h3 className="doc-heading">Quote Approval</h3>
        <p>
          Should the terms of this proposal be acceptable, please sign below and return the applicable service
          agreement. This proposal remains valid for {model.validityDays} days from the date of issue.
        </p>
        {!model.signatureRequired ? (
          <p className="doc-empty">No signature block requested for this proposal.</p>
        ) : (
          <div className="doc-signature">
            <div className="doc-signature__mark">
              {model.signatureMethod === 'draw'
                ? (model.signatureDataUrl
                    ? <img src={model.signatureDataUrl} alt="Signature" className="doc-signature__img" />
                    : <span className="doc-empty">Signature not yet captured</span>)
                : (model.signatoryName
                    ? <span className="doc-signature__script">{model.signatoryName}</span>
                    : <span className="doc-empty">Signature not yet captured</span>)}
            </div>
            <div className="doc-signature__meta">
              On behalf of {model.hotelName || '[Hotel Name]'}<br />
              {model.signatoryName}{model.signatoryTitle ? `, ${model.signatoryTitle}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Appendix — Terms & Conditions */}
      <div className="doc-page">
        <h3 className="doc-heading">Appendix 1 – Terms &amp; Conditions</h3>
        {model.clauses.length === 0 && <p className="doc-empty">No clauses selected.</p>}
        {model.clauses.map(c => (
          <div key={c.id} className="doc-clause">
            <h5 className="doc-subheading2">{c.heading}</h5>
            <p>{c.text}</p>
          </div>
        ))}
      </div>

      <style jsx>{`
        .doc-preview { background: var(--nv-surface-page); padding: 24px 0; border-radius: 12px; }
        .doc-page {
          background: white; max-width: 680px; margin: 0 auto 18px; padding: 40px 48px;
          border-radius: 4px; box-shadow: var(--nv-shadow-sm); font-family: var(--font-raleway);
          font-size: 13px; line-height: 1.7; color: var(--nv-text-body);
        }
        .doc-page p { margin-bottom: 12px; }
        .doc-cover {
          height: 460px; background-size: cover; background-position: center;
          background-color: var(--nv-blue-slate); display: flex; align-items: flex-end; padding: 0;
        }
        .doc-cover__scrim {
          width: 100%; background: linear-gradient(to top, rgba(20,40,50,0.78), rgba(20,40,50,0));
          padding: 32px 48px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
        }
        .doc-cover__title { font-family: var(--font-comfortaa); color: white; font-size: 22px; font-weight: 700; margin-top: 14px; }
        .doc-cover__hotel { color: rgba(255,255,255,0.92); font-size: 14px; }
        .doc-cover__date  { color: rgba(255,255,255,0.7); font-size: 12px; }

        .doc-date    { font-size: 12px; color: var(--nv-text-muted); margin-bottom: 16px; }
        .doc-address { margin-bottom: 16px; }
        .doc-re      { font-weight: 700; margin-bottom: 16px; }
        .doc-toc     { margin: 18px 0; padding-left: 4px; }
        .doc-toc__item { padding: 4px 0; font-weight: 600; color: var(--nv-text-heading); }
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

        .doc-signature { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
        .doc-signature__mark { border-bottom: 1.5px solid var(--nv-border); padding-bottom: 8px; min-height: 60px; display: flex; align-items: flex-end; }
        .doc-signature__script { font-family: var(--font-signature); font-size: 36px; color: var(--nv-text-heading); }
        .doc-signature__img { max-height: 80px; }
        .doc-signature__meta { font-size: 12px; color: var(--nv-text-muted); }

        .doc-clause { margin-bottom: 14px; }
      `}</style>
    </div>
  )
}
