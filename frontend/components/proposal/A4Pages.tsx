'use client'
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
/** 210mm at 96dpi — the on-screen width of one .a4-sheet. */
const A4_WIDTH_PX = 210 * 96 / 25.4

export function A4Pages({ document: value, insertBeforeTerms, appendAtEnd, coverNode, headerVars, frozen = false }: {
  document: A4Document
  insertBeforeTerms?: ReactNode
  /** NUVCL-158: rendered after the last saved page (public Accept & Sign form). */
  appendAtEnd?: ReactNode
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

  // Fit-to-width on narrow screens (2026-10-28): an A4 sheet is a fixed
  // 210mm (~794px) box, so on a phone it overflowed its column and both edges
  // were clipped. Each sheet is CSS-zoomed down to the column width instead
  // (--a4-fit, see globals.css) — the page keeps exactly the layout the PDF
  // has, and the reader pinch-zooms to read. Never above 1, so desktop is
  // unchanged. The PDF export resets the zoom while it captures (.pdf-exporting).
  const wrapRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(1)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const cs = getComputedStyle(el)
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const next = inner > 0 ? Math.min(1, inner / A4_WIDTH_PX) : 1
      setFit(prev => (Math.abs(prev - next) < 0.005 ? prev : next))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { pages, termsIndex } = layout
  const style = { ...(headerVars || {}), '--a4-fit': String(fit) } as CSSProperties
  return <div ref={wrapRef} className={`a4-saved-pages${fit < 1 ? ' a4-saved-pages--fit' : ''}`} style={style}>
    {pages.map((page, index) => <Fragment key={page.id}>
      {insertBeforeTerms && termsIndex === index && insertBeforeTerms}
      {page.kind === 'cover' && coverNode
        ? <div className="a4-sheet a4-sheet--cover">{coverNode}</div>
        : <div className={`a4-sheet a4-sheet--${page.kind}`} dangerouslySetInnerHTML={{ __html: page.html }} />}
    </Fragment>)}
    {insertBeforeTerms && termsIndex === -1 && pages.length > 0 && insertBeforeTerms}
    {appendAtEnd && pages.length > 0 && appendAtEnd}
  </div>
}
