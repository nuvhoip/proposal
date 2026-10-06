'use client'

import React, { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { NuvhoLogo } from '@/components/ui/NuvhoLogo'
import { ProposalDocument } from '@/components/proposal/ProposalDocument'
import { SignaturePad } from '@/components/proposal/SignaturePad'
import { buildDocModelFromProposal, getVisibleSections } from '@/lib/documentModel'
import type { ProposalDocModel } from '@/lib/documentModel'

/* Public, unauthenticated proposal view (proposals.nuvho.com/p/{signing_token}).
   Renders the exact same <ProposalDocument> the internal Proposal Details page
   shows staff (cover, letter, background, scope of works, fee structure, and
   Quote Approval / signature block, plus the terms appendix) so the client is
   reviewing the real proposal rather than a placeholder summary. The Accept
   This Proposal control below the document signs using whichever method
   (typed name or drawn signature) the proposal's Quote Approval section is
   configured for, via the same <SignaturePad> the internal wizard uses. */
export default function PublicProposalPage() {
  const params = useParams<{ id: string }>()
  const [raw,      setRaw]      = useState<any | null>(null)
  const [docModel, setDocModel] = useState<ProposalDocModel | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [signing,  setSigning]  = useState(false)
  const [signed,   setSigned]   = useState(false)
  const [exporting, setExporting] = useState(false)

  // Signing form state — seeded from the proposal's own Quote Approval
  // fields once it loads, so a pre-filled signatory name/title carries
  // through rather than starting blank. sigMethod is a client-chosen toggle
  // (Type name / Draw signature) — same choice the internal wizard's Terms
  // step offers staff — rather than being locked to one method.
  const [sigMethod,  setSigMethod]  = useState<'type' | 'draw'>('type')
  const [sigName,    setSigName]    = useState('')
  const [sigTitle,   setSigTitle]   = useState('')
  const [sigDataUrl, setSigDataUrl] = useState('')
  // NUVCL-105: requires an explicit "I have read and agree to the Terms and
  // Conditions" acknowledgement before Accept & Sign is enabled — mirrors
  // the approval statement added to the Quote Approval section of the
  // generated document itself.
  const [approved, setApproved] = useState(false)
  // NUVCL-154: one acceptance checkbox per proposed service (never per
  // component/scope item). The client can sign with any non-empty subset;
  // the worker records the rest as declined and drops them from the fees,
  // automations and Master Registry engagements.
  const [acceptedServices, setAcceptedServices] = useState<string[]>([])

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/p/${params.id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setRaw(d.data)
        const model = buildDocModelFromProposal(d.data)
        setDocModel(model)
        // model.signatoryName/signatoryTitle/signatureMethod/signatureDataUrl
        // are the SENDER's own letter sign-off ("Yours sincerely, ...") —
        // not the client's. The Accept & Sign form is the client signing as
        // themselves, so it seeds from the hotel contact's own name/title
        // instead, and always starts on the simpler "type name" method with
        // a blank signature canvas rather than showing the sender's drawn
        // signature as if the client had already signed.
        setSigMethod('type')
        setSigName(model.contactName)
        setSigTitle(model.contactTitle)
        setSigDataUrl('')
        setSigned(d.data.status === 'signed')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.id])

  // Services in this proposal, in document order (docModel.services mirrors
  // the saved proposal_services order).
  const offeredServices = docModel?.services.map(s => ({ code: s.code, label: s.label })) ?? []
  // Whether the document has a Terms & Conditions section (enabled clauses,
  // shown only when the T&C appendix itself renders). No T&C → no
  // "I have read and agree to the terms and conditions" checkbox at all.
  const hasTerms = !!docModel && getVisibleSections(docModel).some(s => s.key === 'appendix')

  async function handleSign() {
    if (!docModel) return
    if (hasTerms && !approved) return
    if (offeredServices.length && !acceptedServices.length) return
    if (!sigName.trim()) return
    if (sigMethod === 'draw' && !sigDataUrl) return
    setSigning(true)
    setError(null)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_WORKER_URL}/p/${params.id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signatureMethod:   sigMethod,
          signatoryName:     sigName.trim(),
          signatoryTitle:    sigTitle.trim(),
          signatureDataUrl:  sigMethod === 'draw' ? sigDataUrl : '',
          acceptedServices,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to sign proposal')

      // NUVCL-131: reflect the just-captured CLIENT signature straight into
      // the rendered document, without a refetch — into the dedicated
      // client_* fields (see documentModel.ts), not the sender's own
      // signatureMethod/signatoryName/signatureDataUrl, which are the
      // sender's letter sign-off and must stay untouched. This is what
      // ProposalDocument.tsx's doc-client-acceptance block (top of Terms &
      // Conditions) reads from — previously the client's signature was
      // written into the sender's own fields instead, so it never showed up
      // distinctly, and was missing from the generated PDF entirely.
      setDocModel(prev => prev ? {
        ...prev,
        clientSignatoryName:    sigName.trim(),
        clientSignatoryTitle:   sigTitle.trim(),
        clientSignatureMethod:  sigMethod,
        clientSignatureDataUrl: sigMethod === 'draw' ? sigDataUrl : '',
        clientSignedAt:         new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }),
        clientAcceptedServices: offeredServices.filter(s => acceptedServices.includes(s.code)).map(s => s.label),
        clientDeclinedServices: offeredServices.filter(s => !acceptedServices.includes(s.code)).map(s => s.label),
      } : prev)
      setSigned(true)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSigning(false)
    }
  }

  // NUVCL-131: PDF download for the client, once signed — same print-to-PDF
  // mechanism as the internal Proposal Details page's "⬇ PDF" button
  // (window.print(); @media print in globals.css hides everything except
  // #proposal-print-root, which <ProposalDocument> renders into, and hides
  // .no-print content such as the sign form / this button itself).
  const handleDownloadPdf = () => {
    setExporting(true)
    window.setTimeout(() => window.print(), 50)
    window.setTimeout(() => setExporting(false), 600)
  }

  if (loading) return <LoadingScreen />
  if (!raw || !docModel) return <ErrorScreen message={error || 'Proposal not found'} />

  const isExpired = raw.status === 'expired' ||
    (raw.expires_at && new Date(raw.expires_at) < new Date())

  return (
    <div className="public-page">
      {/* Header */}
      {/* Client-portal top-header shell (browser-app-shell §1): white bar,
          2px #C0D8E5 rule, Logo / Primary at the locked 36px topbar height. */}
      <header className="public-header">
        <NuvhoLogo variant="primary" height={36} />
        <div className="public-header__meta">
          <span className="public-header__ref">
            Proposal #{raw.np_id || (raw.id ? raw.id.slice(0, 8).toUpperCase() : '')}
          </span>
          {raw.expires_at && (
            <span className="public-header__expiry">
              Valid until {new Date(raw.expires_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          )}
        </div>
      </header>

      {/* NUVCL-131: the actual proposal — same component + model builder as
          the internal Proposal Details page, so nothing here is a summary
          or placeholder. The Accept & Sign form (while unsigned, not yet
          expired) is now passed in as beforeAppendix so it renders directly
          above Terms & Conditions instead of below the entire document —
          it's wrapped in .no-print (globals.css) so it never shows up in
          the printed/PDF output, only the live page. */}
      <div className="public-doc-wrap">
        <ProposalDocument
          model={docModel}
          sectionPages
          beforeAppendix={!signed && !isExpired ? (
            <div className="public-sign-form-wrap no-print">
                <div className="public-sign-form">
                  <h2 className="public-section-title">Accept this Document</h2>
                  <p style={{ fontSize: 14, color: 'var(--nv-text-muted)', marginBottom: 20 }}>
                    By signing below, you acknowledge and accept the terms and services outlined in this document.
                  </p>

                  <div className="sign-fields">
                    <div className="sign-field">
                      <label className="sign-label">Your full name</label>
                      <input
                        className="nv-input"
                        placeholder="Your full name"
                        value={sigName}
                        onChange={e => setSigName(e.target.value)}
                      />
                    </div>
                    <div className="sign-field">
                      <label className="sign-label">Title (optional)</label>
                      <input
                        className="nv-input"
                        placeholder="e.g. General Manager"
                        value={sigTitle}
                        onChange={e => setSigTitle(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Same Type name / Draw signature toggle as the internal
                      wizard's Terms & Conditions step — the client picks how
                      they sign rather than being locked to one method. */}
                  <div className="nv-tabs signature-method" role="tablist" aria-label="Signature method">
                    <button type="button" role="tab" aria-selected={sigMethod === 'type'}
                      className={`nv-tab ${sigMethod === 'type' ? 'nv-tab--active' : ''}`}
                      onClick={() => setSigMethod('type')}>
                      Type name
                    </button>
                    <button type="button" role="tab" aria-selected={sigMethod === 'draw'}
                      className={`nv-tab ${sigMethod === 'draw' ? 'nv-tab--active' : ''}`}
                      onClick={() => setSigMethod('draw')}>
                      Draw signature
                    </button>
                  </div>

                  {sigMethod === 'draw' ? (
                    <div className="sign-capture">
                      <span className="sign-capture__label">Draw signature</span>
                      <SignaturePad value={sigDataUrl} onChange={setSigDataUrl} />
                    </div>
                  ) : (
                    <div className="sign-capture">
                      <span className="sign-capture__label">Signature preview</span>
                      <div className="sign-capture__script">{sigName || 'Your name here'}</div>
                    </div>
                  )}

                  {offeredServices.length > 0 && (
                    <fieldset className="service-accept">
                      <legend className="sign-label">Scope you accept:</legend>
                      {/* Only the service lines selected for this document
                          when it was created, named as in Service Lines. */}
                      {offeredServices.map(s => (
                        <label key={s.code} className="approval-check service-accept__item">
                          <input type="checkbox" checked={acceptedServices.includes(s.code)}
                            onChange={e => setAcceptedServices(prev => e.target.checked
                              ? [...prev, s.code]
                              : prev.filter(code => code !== s.code))} />
                          {/* "MK - Marketing", "CA - Confidentiality Agreement" */}
                          <span>{s.label && s.label !== s.code ? `${s.code} - ${s.label}` : s.code}</span>
                        </label>
                      ))}
                      {acceptedServices.length > 0 && acceptedServices.length < offeredServices.length && (
                        <p className="service-accept__hint">Services you leave unticked won’t be included in the agreement or its fees.</p>
                      )}
                    </fieldset>
                  )}

                  {/* Only when the document has Terms & Conditions. */}
                  {hasTerms && (
                    <label className="approval-check">
                      <input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />
                      <span>
                        I have read and agree to the{' '}
                        <a href="#doc-section-appendix" onClick={e => {
                          e.preventDefault()
                          document.getElementById('doc-section-appendix')?.scrollIntoView({ behavior: 'smooth' })
                        }}>terms and conditions</a>.
                      </span>
                    </label>
                  )}

                  <button
                    className="nv-btn nv-btn--primary"
                    onClick={handleSign}
                    disabled={signing || (hasTerms && !approved) || (offeredServices.length > 0 && !acceptedServices.length) || !sigName.trim() || (sigMethod === 'draw' && !sigDataUrl)}
                    aria-busy={signing}
                  >
                    {signing ? 'Signing…' : 'Accept and sign'}
                  </button>

                  {error && (
                    <p style={{ color: 'var(--nv-error)', fontSize: 13, marginTop: 8 }}>{error}</p>
                  )}
                </div>
            </div>
          ) : undefined}
        />
      </div>

      {/* Post-signing / expired state — stays below the whole document
          (rather than above Terms & Conditions like the active sign form
          above) since it's a final confirmation/status screen, not part of
          the signing flow itself. */}
      {(signed || isExpired) && (
        <div className="public-body">
          <section className="public-section public-sign-section">
            {signed ? (
              <div className="public-signed">
                <span className="nv-iconbox nv-iconbox--32 public-signed__mark">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/circle-check.svg" alt="" /></span>
                <h3>Proposal accepted</h3>
                <p>Thank you for accepting this proposal. Our team will be in touch shortly to begin onboarding.</p>
                {/* NUVCL-131: download the signed proposal, including the
                    client's own signature (now rendered in the Appendix —
                    see ProposalDocument.tsx's doc-client-acceptance block). */}
                <button
                  className="nv-btn nv-btn--secondary"
                  onClick={handleDownloadPdf}
                  disabled={exporting}
                  style={{ marginTop: 16 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/icons/download.svg" width={14} height={14} alt="" className="nv-icon-inline" />{exporting ? 'Preparing…' : 'Download PDF'}
                </button>
              </div>
            ) : (
              <div className="public-expired">
                <h3>Proposal expired</h3>
                <p>This proposal has expired. Please contact your Nuvho representative to receive an updated proposal.</p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      <footer className="public-footer">
        <span>© Nuvho Systems Pty Ltd</span>
      </footer>

      <style jsx>{`
        .public-page {
          min-height: 100vh;
          background: var(--nv-surface-page);
          display: flex;
          flex-direction: column;
        }

        /* Header — client-portal top-header shell */
        .public-header {
          background: #FFFFFF;
          border-bottom: 2px solid #C0D8E5;
          padding: 16px 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        @media (max-width: 900px) { .public-header { padding: 16px 24px; } }
        .public-header__meta { text-align: right; }
        .public-header__ref  { font-size: 14px; color: var(--nv-text-muted); display: block; }
        .public-header__expiry { font-size: 12px; color: var(--nv-text-muted); }

        /* Document wrapper — ProposalDocument renders its own cover/letter/
           section pages inside this, so it just needs the page's top/bottom
           breathing room, not its own max-width (ProposalDocument sets that
           per-page already). */
        .public-doc-wrap { padding: 32px 24px 0; }

        .public-body {
          /* NUVCL-146 fix (2026-09-02): this used to also set
             max-width: 820px, which capped this wrapper's CONTENT box at
             820 - 48 (padding) = 772px — narrower than .public-sign-section's
             own width: 210mm (~793.7px @ 96dpi), so the confirmation card
             still rendered visibly narrower than every document page above
             it despite that width:210mm rule already being correct. Removed
             the max-width entirely so .public-sign-section's own sizing
             controls its width, exactly like .public-doc-wrap (which never
             had a max-width of its own) lets ProposalDocument's .doc-flow/
             .doc-page control theirs. .public-body has exactly one use
             (this post-signing/expired confirmation section, see the JSX
             below) so there's no other content relying on the old 820px
             reading-width cap. */
          width: 100%;
          margin: 0 auto;
          padding: 0 24px 48px;
        }

        /* NUVCL-131: the Accept & Sign form now renders as a child of
           ProposalDocument's own .doc-flow card (via beforeAppendix), which
           already supplies the white background/shadow/padding — so this
           wrapper only needs a separating rule above it, matching the
           spacing between .doc-section blocks, rather than repeating the
           .public-sign-section "card" styling and nesting a card in a card. */
        .public-sign-form-wrap {
          margin-top: 32px;
          margin-bottom: 32px;
          padding-top: 32px;
          border-top: 1px solid var(--nv-border-hair);
        }

        .public-section { margin-bottom: 0; }
        /* Heading styled to match <ProposalDocument>'s .doc-heading (NUVCL-98)
           so "Accept This Proposal" reads as another section of the document
           rather than a visually distinct widget. */
        .public-section-title {
          font-family: var(--nv-font-body);
          font-size: 16px;
          font-weight: 700;
          color: var(--nv-text-heading);
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 2px solid var(--nv-border-hair);
        }

        /* Signing — container styled to match <ProposalDocument>'s .doc-page
           (NUVCL-98): same white card, 40/48 padding, 4px radius, and
           shadow-sm, so the signature box looks like the next page of the
           proposal instead of a separate bordered widget. Width updated
           2026-09-01 to 210mm (matching .doc-page/.doc-flow's real A4
           width) — this rule still said 680px, a leftover from before
           NUVCL-120 switched the document itself from an arbitrary "web
           card" width to real A4 sizing, so the post-signing confirmation
           card had drifted narrower than every page above it. */
        .public-sign-section {
          background: white;
          width: 210mm;
          max-width: 100%;
          box-sizing: border-box;
          margin: 0 auto;
          padding: 40px 48px;
          border-radius: 4px;
          font-family: var(--font-raleway);
        }
        @media (max-width: 900px) {
          .public-sign-section { padding: 28px 24px; }
        }

        .sign-fields {
          display: flex;
          gap: 16px;
          margin-bottom: 20px;
        }
        .sign-field { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .sign-label {
          font-size: 13px; font-weight: 500; color: var(--nv-text-body);
        }
        @media (max-width: 900px) { .sign-fields { flex-direction: column; } }

        /* Figma tab bar (185:18) for the type / draw choice */
        .signature-method { margin-bottom: 20px; }

        .sign-capture { margin-bottom: 20px; }
        .sign-capture__label {
          display: block; font-size: 13px; font-weight: 500; color: var(--nv-text-body); margin-bottom: 8px;
        }
        .sign-capture__script {
          font-family: var(--font-signature);
          font-size: 40px;
          line-height: 1.3;
          color: var(--nv-text-heading);
          padding: 6px 14px 10px;
          border-bottom: 1px solid var(--nv-border-hair);
          /* Was max-width: 420px, which made the sign-here line noticeably
             narrower than the A4 page (.public-sign-section, 210mm) it sits
             on — width: 100% lets it span the same content width as the
             sign-fields inputs above it, matching the rest of the page. */
          width: 100%;
        }

        .approval-check {
          display: flex; align-items: flex-start; gap: 8px; font-size: 13px;
          color: var(--nv-text-muted); margin: 16px 0; cursor: pointer;
        }
        .approval-check { color: var(--nv-text-body); font-size: 14px; align-items: center; }
        .approval-check a { color: var(--nv-blue-slate); text-decoration: underline; }
        /* NUVCL-154 per-service acceptance */
        .service-accept { border: 1px solid var(--nv-border-hair); border-radius: 8px; padding: 12px 16px 4px; margin: 20px 0 0; }
        .service-accept legend { padding: 0 6px; margin-left: -6px; }
        .service-accept__item { margin: 10px 0; }
        .service-accept__hint { font-size: 12px; color: var(--nv-text-muted); margin: 0 0 10px; }

        .public-signed, .public-expired {
          text-align: center;
          padding: 20px;
        }
        /* Tailwind's Preflight sets svg { display: block }, which makes the
           parent's text-align:center above have no effect on it (that only
           centers inline/inline-block content) — the checkmark was sitting
           flush left instead of centered above the heading. */
        .public-signed :global(.public-signed__mark) { display: grid; margin: 0 auto; }
        .public-signed h3, .public-expired h3 {
          font-family: var(--nv-font-display);
          font-size: 24px;
          font-weight: 500;
          color: var(--nv-text-heading);
          margin: 16px 0 8px;
        }
        .public-signed p, .public-expired p {
          color: var(--nv-text-muted);
          font-size: 14px;
          line-height: 1.6;
          max-width: 400px;
          margin: 0 auto;
        }

        /* Footer — centred copyright, 11px (client-portal shell) */
        .public-footer {
          padding: 24px;
          text-align: center;
        }
        .public-footer span {
          font-size: 11px;
          color: var(--nv-text-muted);
        }
      `}</style>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:20, background:'var(--nv-surface-page)' }}>
      <NuvhoLogo variant="primary" height={40} />
      <span className="nv-spinner" aria-label="Loading" />
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      flexDirection:'column', gap:16, background:'var(--nv-surface-page)', padding:24 }}>
      <NuvhoLogo variant="primary" height={40} />
      <h2 style={{ font: 'var(--nv-ui-h2)', color:'var(--nv-text-heading)', letterSpacing: 0 }}>
        Proposal not found
      </h2>
      <p style={{ color:'var(--nv-text-muted)', fontSize:14, textAlign:'center', maxWidth:360 }}>
        {message}. Please check the link or contact your Nuvho representative.
      </p>
    </div>
  )
}
