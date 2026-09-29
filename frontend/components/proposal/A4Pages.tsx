'use client'
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { sanitizePageHtml, splitPagesAtTerms, type A4Document, type A4Page } from '@/lib/a4Document'

/** Saved document pages used by the detail, client view and print/PDF paths.
 *
 * `insertBeforeTerms` renders one extra block immediately above where Terms
 * & Conditions begins. The public signing page uses it for "Accept This
 * Proposal" (and, once signed, the Client Acceptance record), so the order
 * reads: ... Fee Structure → Accept → Terms & Conditions. When T&C starts
 * partway down a saved page, that page is split in two at the heading (see
 * splitPagesAtTerms) so no Fee Structure content ends up below the insert.
 * With no recognisable T&C heading, the block is appended after the last
 * page, which is where it rendered before 2026-09-25.
 *
 * `coverNode`, when given, is rendered in place of every saved `kind: 'cover'`
 * page. The saved cover HTML is only a snapshot from when the A4 layout was
 * first created, so it goes stale the moment a different cover is picked (and
 * a custom upload's blob: preview URL is stripped from it entirely) —
 * ProposalDocument passes its live cover instead. */
export function A4Pages({ document: value, insertBeforeTerms, coverNode, headerVars, frozen = false }: {
  document: A4Document
  insertBeforeTerms?: ReactNode
  coverNode?: ReactNode
  /** NUVCL-153 running-header custom properties (see pageHeaderVars). */
  headerVars?: Record<string, string>
  /** Signed proposal: render saved pages exactly as signed (no retroactive rewrites). */
  frozen?: boolean
}) {
  const [layout, setLayout] = useState<{ pages: A4Page[]; termsIndex: number }>({ pages: [], termsIndex: -1 })
  // Only the presence of an insert changes the layout — not the node's
  // identity, which is new on every parent render.
  const wantsInsert = !!insertBeforeTerms
  useEffect(() => {
    const clean = value.pages.map(p => ({ ...p, html: sanitizePageHtml(p.html, { legacyUpgrades: !frozen }) }))
    setLayout(wantsInsert ? splitPagesAtTerms(clean) : { pages: clean, termsIndex: -1 })
  }, [value, wantsInsert, frozen])

  const { pages, termsIndex } = layout
  return <div className="a4-saved-pages" style={headerVars as CSSProperties | undefined}>
    {pages.map((page, index) => <Fragment key={page.id}>
      {insertBeforeTerms && termsIndex === index && insertBeforeTerms}
      {page.kind === 'cover' && coverNode
        ? <div className="a4-sheet a4-sheet--cover">{coverNode}</div>
        : <div className={`a4-sheet a4-sheet--${page.kind}`} dangerouslySetInnerHTML={{ __html: page.html }} />}
    </Fragment>)}
    {insertBeforeTerms && termsIndex === -1 && pages.length > 0 && insertBeforeTerms}
  </div>
}
