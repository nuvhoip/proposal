'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProposalDocument } from './ProposalDocument'
import { getVisibleSections } from '@/lib/documentModel'
import type { ProposalDocModel } from '@/lib/documentModel'

/*
  PaginatedPreview — wraps <ProposalDocument> for the wizard's Preview &
  Save step (Step7Preview) and runs its rendered markup through Paged.js
  (https://pagedjs.org), a CSS Paged Media engine, so the preview shown
  before saving is made of real, fixed-size A4 page boxes — including
  automatically spilling a too-long Terms & Conditions list or Scope of
  Works onto as many additional pages as it actually needs, using the exact
  same break rules (public/print-rules.css) the real printed/exported PDF
  uses. See ProposalDocument.tsx's own comment on why it can't do this
  itself (it always renders as one unbounded-height .doc-flow).

  CRITICAL ARCHITECTURE NOTE — read this before changing how Paged.js runs
  here. The first version of this component ran Paged.js directly in the
  main page's own JS (`await import('pagedjs')` inside this component,
  rendering into a plain <div>). That shipped broken: the whole wizard went
  blank white. Root cause, confirmed by reading Paged.js's source AND
  reproducing it with an actual Playwright test (2026-09-01): Paged.js's
  internal `Polisher` does `document.head.appendChild(styleEl)` against
  whatever `document` its own script is executing in — it has NO way to
  scope injected styles to a specific container, regardless of what
  `renderTo` element you pass it. print-rules.css's real-print "isolation"
  rule (`body * { visibility: hidden } #proposal-print-root, ... {
  visibility: visible }` — needed so `window.print()` doesn't print the
  whole wizard chrome) therefore applied to the ENTIRE live app the instant
  Paged.js ran, hiding everything. This is a confirmed, open Paged.js
  limitation (see https://github.com/pagedjs/pagedjs/issues/219), not
  something a `renderTo` container or React ref can work around.

  The fix: Paged.js runs entirely inside its own <iframe>, loaded from a
  vendored copy of its browser bundle (public/pagedjs/paged.js — see that
  file's own header comment) via a plain <script src> tag INSIDE the
  iframe's `srcdoc` document, so `document` inside Paged.js's own script
  resolves to the iframe's document, not this page's. Communication with
  the iframe is one-way-at-a-time postMessage: the iframe posts
  'pagedjs-ready' once its script has loaded, this component replies with
  'pagedjs-render' (the content HTML — sent via postMessage, not templated
  into the srcdoc string, so a proposal's own HTML content can never break
  out of that string or need manual escaping), and the iframe posts back
  'pagedjs-done' (with the page count and the iframe's total content
  height, so this component can size the iframe to fit with no internal
  scrollbar) or 'pagedjs-error'. A brand new iframe is created for every
  pagination pass (see the debounced effect below) rather than trying to
  re-run Paged.js inside a reused one — simplest way to guarantee a clean
  slate every time, and the vendored script is cached by the browser after
  the first load so this isn't as expensive as it sounds.

  Do not "simplify" this back to importing `pagedjs` directly into this
  component's own render. That is the exact change that broke the app.

  Second consequence of the same isolation, also confirmed by a Playwright
  test before shipping: because the iframe is a fully separate document, it
  starts with NONE of this app's own CSS — not globals.css, not Tailwind's
  compiled utilities, and critically not the <style> tag styled-jsx
  generates for ProposalDocument's own :global() rules (the actual colors/
  fonts/layout for .doc-page, .doc-cover, .doc-clause, etc.). Handing the
  iframe only print-rules.css would paginate correctly but render
  completely unstyled plain text. The fix (see the pagination effect below)
  is to clone every <link rel="stylesheet"> and <style> tag currently in
  this page's own <head> into the iframe's <head> on every pagination pass
  — print-rules.css is still passed separately to Paged.js's own
  `stylesheets` argument, since that one specifically needs to reach
  Paged.js's pagination engine, not just the browser's normal CSS cascade.

  ROUND 2 (2026-09-01, same day) — the iframe fix above stopped the whole
  wizard from going blank, but the preview panel itself still rendered
  empty. Two SEPARATE bugs, found by reproducing the exact symptom with
  Playwright and inspecting the iframe's own DOM rather than guessing:

  1. print-rules.css's isolation rule (`body * { visibility: hidden }` /
     `#proposal-print-root, ... { visibility: visible }`) relies on
     `#proposal-print-root`'s id surviving on every element Paged.js
     renders. It doesn't: the id was present on page 1's clone but gone
     from page 2 onward, so `body * { visibility: hidden }` won this fight
     everywhere except page 1 — most of the document rendered but was
     invisible. print-rules.css itself is untouched (it's still the exact
     ruleset the real print/PDF pipeline uses); instead
     public/print-rules-preview-overrides.css is now passed as a SECOND
     stylesheet to `previewer.preview()` below, purely to cancel that rule
     (and the #proposal-print-root positioning rule, see point 2) inside
     this iframe, where there's no wizard chrome to hide in the first
     place. See that file's own header comment for the full detail.

  2. Independently, this component was sending `sourceRef.current
     .outerHTML` — the off-screen MEASUREMENT WRAPPER's own outerHTML,
     inline-styled `position:absolute;left:-99999px` (see that div in the
     JSX below) to hide it in THIS window. Since that inline style is part
     of the HTML string itself, not a stylesheet rule, it rode along as an
     ancestor of every node Paged.js paginated, leaving every rendered
     page positioned at that same -99999px offset INSIDE the iframe too —
     invisible regardless of any stylesheet fix. Confirmed via
     getBoundingClientRect() on the actual rendered `.doc-clause` nodes
     inside `.pagedjs_page` in the reproduction. Fixed by sending
     `#proposal-print-root`'s own outerHTML (a child of the wrapper)
     instead — see the `pagedjs-ready` handler below.

  Both bugs had to be found and fixed together: fixing only #1 still left
  a blank-looking preview (confirmed by an actual screenshot, not just
  computed-style checks) because #2 alone still pushed everything
  off-screen. Fixing only #2 would have left later pages invisible from
  #1's id-loss. Neither showed up in `tsc`/lint — same lesson as round 1.
*/

export function PaginatedPreview({ model, onTogglePageBreak, onEdit, onMoveBlock, layoutRevision = 0 }: {
  model: ProposalDocModel
  onMoveBlock?: (path: string[], direction: -1 | 1) => void
  layoutRevision?: number
  onEdit?: (path: string[], value: string) => void
  onTogglePageBreak?: (sectionKey: string, checked: boolean) => void
}) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const controlsSlotRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLElement>(null)
  const [floating, setFloating] = useState<{
    left: number; top: number; width: number; maxHeight: number; visible: boolean; wide: boolean
  } | null>(null)
  const editable = !!onEdit
  const floatingMounted = floating !== null
  const updateFloatingRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!editable) { setFloating(null); return }
    let frame = 0
    function positionControls() {
      frame = 0
      const slot = controlsSlotRef.current
      const layout = layoutRef.current
      if (!slot || !layout) return
      const bounds = slot.getBoundingClientRect()
      const documentBounds = layout.getBoundingClientRect()
      const viewportHeight = window.innerHeight
      const panelHeight = controlsRef.current?.getBoundingClientRect().height || 0
      // Reserve the floating panel's original space, including on mobile.
      if (panelHeight) slot.style.minHeight = `${panelHeight}px`
      const next = {
        left: bounds.left,
        top: Math.max(16, Math.min(bounds.top, documentBounds.bottom - panelHeight - 16)),
        width: bounds.width,
        maxHeight: Math.max(120, viewportHeight - 32),
        visible: documentBounds.bottom > 16 && documentBounds.top < viewportHeight,
        wide: documentBounds.width >= 900,
      }
      setFloating(previous => previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    function schedulePosition() {
      if (!frame) frame = window.requestAnimationFrame(positionControls)
    }
    updateFloatingRef.current = schedulePosition
    // Capture scrolls from both the window and nested app scroll containers.
    document.addEventListener('scroll', schedulePosition, true)
    window.addEventListener('resize', schedulePosition)
    const observer = new ResizeObserver(schedulePosition)
    if (layoutRef.current) observer.observe(layoutRef.current)
    if (controlsSlotRef.current) observer.observe(controlsSlotRef.current)
    positionControls()
    return () => {
      updateFloatingRef.current = () => {}
      document.removeEventListener('scroll', schedulePosition, true)
      window.removeEventListener('resize', schedulePosition)
      observer.disconnect()
      window.cancelAnimationFrame(frame)
    }
  }, [editable])

  // Selecting a different block or expanding section controls can resize the panel.
  useEffect(() => {
    const panel = controlsRef.current
    if (!panel) return
    const observer = new ResizeObserver(() => updateFloatingRef.current())
    observer.observe(panel)
    return () => observer.disconnect()
  }, [floatingMounted])

  const editRef = useRef(onEdit)
  editRef.current = onEdit
  const [selection, setSelection] = useState<{ key: string; label: string; move?: string[] } | null>(null)
  const [reflowRevision, setReflowRevision] = useState(0)
  const sourceRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tokenRef = useRef(0)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [status, setStatus] = useState<'measuring' | 'ready' | 'error'>('measuring')

  // Keep the same editable DOM for the entire editing session. Draft
  // updates must not destroy the iframe, selection, focus or undo history.
  // Only an explicit page-break change rebuilds editable pages. Read-only
  // previews still follow all model changes.
  const layoutKey = onEdit
    ? JSON.stringify(model.pageBreaks || {})
    : JSON.stringify(model)

  useEffect(() => {
    let cancelled = false
    const token = ++tokenRef.current
    setStatus('measuring')
    const scrollY = window.scrollY
    let activeIframe: HTMLIFrameElement | null = null

    function cleanupIframe() {
      window.removeEventListener('message', onMessage)
      if (activeIframe && activeIframe.parentNode) {
        if (containerRef.current) containerRef.current.style.minHeight = `${activeIframe.getBoundingClientRect().height}px`
        activeIframe.parentNode.removeChild(activeIframe)
      }
      activeIframe = null
    }

    function onMessage(event: MessageEvent) {
      if (!activeIframe || event.source !== activeIframe.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'pagedjs-select' && typeof data.key === 'string' && data.key.startsWith('block:')) {
        setSelection({ key: data.key, label: String(data.label || 'Content block'), move: Array.isArray(data.move) ? data.move : undefined })
        return
      }
      if (data.type === 'pagedjs-edit') {
        if (Array.isArray(data.path) && data.path.every((part: unknown) => typeof part === 'string') && typeof data.value === 'string') {
          editRef.current?.(data.path, data.value)
        }
        return
      }
      if (data.type === 'pagedjs-ready') {
        // Send #proposal-print-root's own outerHTML — NOT
        // sourceRef.current.outerHTML (the off-screen wrapper div around
        // it). The wrapper carries an inline `position:absolute;
        // left:-99999px` (see the JSX below) that exists purely to hide
        // this measurement copy in THIS window; sending the wrapper's own
        // outerHTML bakes that inline style in as an ancestor of every
        // node Paged.js paginates, which keeps the entire preview
        // positioned off-screen inside the iframe too — confirmed via a
        // Playwright reproduction (2026-09-01) to be the reason the
        // preview rendered as blank/empty even after the iframe-isolation
        // fix above: Paged.js reported correct page counts and correct
        // computed styles throughout, because neither of those is
        // affected by position, but every actual page box was placed at
        // x ≈ -99999px, entirely outside the visible viewport.
        const rootEl = sourceRef.current?.querySelector<HTMLElement>('#proposal-print-root')
        activeIframe?.contentWindow?.postMessage(
          { type: 'pagedjs-render', content: rootEl ? rootEl.outerHTML : '', editable: !!editRef.current },
          '*',
        )
        return
      }

      if (data.type === 'pagedjs-done') {
        if (cancelled || token !== tokenRef.current || !activeIframe) return
        activeIframe.style.height = `${Math.ceil(data.height) + 1}px`
        setPageCount(typeof data.total === 'number' ? data.total : null)
        setStatus('ready')
        if (containerRef.current) containerRef.current.style.minHeight = ''
        window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })
        return
      }

      if (data.type === 'pagedjs-error') {
        if (cancelled || token !== tokenRef.current) return
        // eslint-disable-next-line no-console
        console.error('PaginatedPreview: Paged.js pagination failed inside iframe:', data.message)
        setStatus('error')
      }
    }

    // Debounce: the wizard's rich-text/clause editors fire a model change on
    // every keystroke, and a Paged.js layout pass genuinely re-lays-out the
    // whole document — not something to redo on every character.
    const timer = window.setTimeout(() => {
      if (cancelled || token !== tokenRef.current) return
      const container = containerRef.current
      if (!container) return
      container.style.minHeight = `${container.getBoundingClientRect().height}px`

      window.addEventListener('message', onMessage)

      // Clone every stylesheet currently active on THIS page (globals.css,
      // Tailwind's compiled utilities, and — critically — the <style> tag
      // styled-jsx generates for ProposalDocument's own :global() rules,
      // e.g. .doc-page/.doc-cover/.doc-clause colors and fonts) into the
      // iframe's own <head>. Without this, the iframe would only have
      // print-rules.css (passed to Paged.js below purely for pagination —
      // @page size, break rules) and would paginate correctly but render
      // completely unstyled, plain-text pages: the iframe is a fully
      // separate document, so it inherits nothing from this page on its
      // own. Confirmed empirically (2026-09-01, Playwright test) that this
      // clone-on-each-pass approach correctly restores styling inside the
      // iframe.
      const headStyles = Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))
        .map(el => (
          el.tagName === 'LINK'
            ? `<link rel="stylesheet" href="${(el as HTMLLinkElement).href}">`
            : `<style>${el.textContent || ''}</style>`
        ))
        .join('\n')

      const iframe = document.createElement('iframe')
      iframe.className = 'paginated-preview__iframe'
      iframe.setAttribute('title', 'Paginated document preview')
      // srcdoc's own inline script only ever receives content via
      // postMessage (see the file-level comment above) — nothing about the
      // proposal's own text is ever templated into this string, so no
      // escaping concerns here. headStyles (above) is templated in, but it
      // only ever contains hrefs/text this app itself already loaded into
      // its own <head> — never user-authored content.
      iframe.srcdoc = `<!doctype html>
<html><head><meta charset="utf-8">
${headStyles}
<script src="/pagedjs/paged.js"><\/script>
<style>
  html, body { margin: 0; padding: 0; }
  /* Cosmetic layout for Paged.js's own output only, scoped to this
     isolated iframe document — deliberately NOT part of print-rules.css,
     which must stay identical to what the real PDF uses. Paged.js already
     gives each .pagedjs_page real, hard-set A4 dimensions (210mm x 297mm)
     via print-rules.css's @page rule; this just stacks them with visible
     space between so several pages read as separate physical sheets. */
  /* Physical sheets on a neutral desk: the break is empty space outside
     the paper, never a colored marker inside the document content. */
  html, body { background: #e5e7eb; }
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 40px; padding: 24px 16px 40px; background: #e5e7eb; }
  [data-selected-block] { outline: 1px dashed #9ca3af; outline-offset: 4px; }
  [contenteditable] { cursor: text; white-space: pre-wrap; }
  [contenteditable]:hover { outline: 1px dashed #28687f; }
  [contenteditable]:focus { outline: 2px solid #28687f; outline-offset: 3px; }
  .pagedjs_page {
    position: relative; background: #fff; flex-shrink: 0;
    box-shadow: 0 0 0 1px #d1d5db, 0 3px 10px rgba(0,0,0,.12);
  }
  .pagedjs_page::after {
    content: "Page " attr(data-page-number);
    position: absolute; top: 100%; left: 0; right: 0;
    padding-top: 10px; text-align: center;
    font: 11px/16px Arial, sans-serif; color: #6b7280;
    pointer-events: none;
  }
</style>
</head><body>
<div id="target"></div>
<script>
  (function () {
    function post(msg) { window.parent.postMessage(msg, '*'); }
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== window.parent || !data || data.type !== 'pagedjs-render') return;
      (async function () {
        try {
          var target = document.getElementById('target');
          target.innerHTML = '';
          var previewer = new window.Paged.Previewer();
          var flow = await previewer.preview(data.content, ['/print-rules.css', '/print-rules-preview-overrides.css'], target);
          if (data.editable) {
            function selectBlock(event) {
              var block = event.target.closest('[data-doc-block]');
              if (!block) return;
              target.querySelectorAll('[data-selected-block]').forEach(function (node) { node.removeAttribute('data-selected-block'); });
              block.setAttribute('data-selected-block', 'true');
              post({ type: 'pagedjs-select', key: block.dataset.docBlock, label: block.dataset.blockLabel,
                move: block.dataset.blockMove ? JSON.parse(block.dataset.blockMove) : undefined });
            }
            target.addEventListener('click', selectBlock);
            target.addEventListener('focusin', selectBlock);
            target.querySelectorAll('[data-doc-block]').forEach(function (block) {
              block.tabIndex = 0;
              block.setAttribute('aria-label', block.dataset.blockLabel + ': select to arrange');
            });
            target.querySelectorAll('[data-edit-field]').forEach(function (el) {
              el.contentEditable = 'plaintext-only';
              el.setAttribute('role', 'textbox');
              el.setAttribute('aria-label', 'Edit ' + JSON.parse(el.dataset.editField).join(' '));
              el.addEventListener('input', function () {
                // Join fragments when a field spans multiple physical pages.
                var parts = Array.from(target.querySelectorAll('[data-edit-field]')).filter(function (node) {
                  return node.dataset.editField === el.dataset.editField;
                });
                // Repeated table headers are not editable. Repeated hotel names
                // are separate appearances of one field, not split paragraphs.
                var path = JSON.parse(el.dataset.editField);
                var text = path[0] === 'hotel' ? el.innerText : parts.map(function (node) { return node.innerText; }).join('');
                if (path[0] === 'hotel') {
                  parts.forEach(function (node) { if (node !== el) node.textContent = text; });
                }
                if (el.dataset.editNumber) {
                  text = text.replace(/[^0-9.-]/g, '');
                  if (text && (!Number.isFinite(Number(text)) || Number(text) < 0)) return;
                }
                if (el.dataset.editHtml) {
                  var safe = document.createElement('div');
                  text.split('\\n').forEach(function (line) { var p = document.createElement('p'); p.textContent = line; safe.appendChild(p); });
                  text = safe.innerHTML;
                }
                post({ type: 'pagedjs-edit', path: path, value: text });
              });
            });
          }
          post({ type: 'pagedjs-done', total: flow.total, height: document.body.scrollHeight });
        } catch (e) {
          post({ type: 'pagedjs-error', message: String((e && e.message) || e) });
        }
      })();
    });
    post({ type: 'pagedjs-ready' });
  })();
<\/script>
</body></html>`

      container.innerHTML = ''
      container.appendChild(iframe)
      activeIframe = iframe
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      cleanupIframe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, layoutRevision, reflowRevision])

  const visibleSections = getVisibleSections(model)

  return (
    <div className="paginated-preview">
      <div ref={layoutRef} className={`paginated-preview__layout${onEdit ? " paginated-preview__layout--editable" : ""}`}>
      {onEdit && <div ref={controlsSlotRef} className="paginated-preview__controls-slot" />}
      {onEdit && floating && createPortal(
        <aside ref={controlsRef}
          className={`paginated-preview__arrange no-print${floating.wide ? ' paginated-preview__arrange--wide' : ''}`}
          style={{ position: 'fixed', left: floating.left, top: floating.top, width: floating.width,
            maxHeight: floating.maxHeight, visibility: floating.visible ? 'visible' : 'hidden' }}
          aria-label="Arrange document content">
          <h3>Arrange content</h3>
          <span>{selection ? selection.label : 'Select a paragraph, scope item, table or clause to arrange it.'}</span>
          <div className="paginated-preview__actions">
            <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm"
              disabled={!selection || status !== 'ready' || !!model.pageBreaks?.[selection.key]}
              onClick={() => selection && onTogglePageBreak?.(selection.key, true)}>Start on next page</button>
            <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm"
              disabled={!selection || status !== 'ready' || !model.pageBreaks?.[selection.key]}
              onClick={() => selection && onTogglePageBreak?.(selection.key, false)}>Remove page break</button>
            {selection?.move && onMoveBlock && <>
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" disabled={status !== 'ready'}
                onClick={() => onMoveBlock(selection.move!, -1)}>Move earlier</button>
              <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" disabled={status !== 'ready'}
                onClick={() => onMoveBlock(selection.move!, 1)}>Move later</button>
            </>}
            <button type="button" className="nv-btn nv-btn--outlined nv-btn--sm" disabled={status !== 'ready'}
              onClick={() => setReflowRevision(n => n + 1)}>Reflow pages</button>
          </div>
          <small>Text stays in place while you type. Reflow pages after adding text; remove a break to let content flow back.</small>
          <details className="paginated-preview__section-breaks">
            <summary>Section page breaks</summary>
      {onTogglePageBreak && visibleSections.length > 0 && (
        <div className="paginated-preview__breaks no-print">
          <span className="paginated-preview__breaks-label">Force a page break before:</span>
          {visibleSections.map(section => (
            <label key={section.key} className="paginated-preview__break-toggle">
              <input
                type="checkbox"
                checked={!!model.pageBreaks?.[section.key]}
                onChange={e => onTogglePageBreak(section.key, e.target.checked)}
              />
              <span>{section.label}</span>
            </label>
          ))}
        </div>
      )}
          </details>
        </aside>, document.body
      )}
      <div className="paginated-preview__document">
      {status === 'error' && (
        <div className="paginated-preview__banner paginated-preview__banner--error">
          Couldn&apos;t generate an accurate page-by-page preview — showing the plain document
          below instead. This doesn&apos;t affect the actual PDF/Word export.
        </div>
      )}
      {status === 'measuring' && (
        <div className="paginated-preview__banner">Laying out A4 pages…</div>
      )}
      {status === 'ready' && pageCount !== null && (
        <div className="paginated-preview__banner">
          Initial A4 layout: <strong>{pageCount}</strong> page{pageCount === 1 ? '' : 's'}. {onEdit && 'Final pagination is applied when printing or exporting.'}
        </div>
      )}

      {/* Paged.js's own isolated <iframe> is created and inserted here
          imperatively by the effect above — see this file's top comment
          for why it must run inside an iframe and not a plain div. */}
      {status !== 'error' && (
        <div ref={containerRef} className="paginated-preview__pages" aria-live="polite" />
      )}

      {/* Hidden source: ProposalDocument's normal, unbounded-height markup,
          rendered off-screen (not display:none — some browsers skip layout
          for that) purely so the pagination effect above has real, laid-out
          DOM to snapshot via outerHTML. On a pagination error, this is
          shown in place instead (moved on-screen, scrollable) so the step
          never just goes blank. pageBreakEditable is left off here on
          purpose — the checkboxes live in the toggle strip above instead,
          since Paged.js's iframe has no React event handlers at all. */}
      <div
        ref={sourceRef}
        className="paginated-preview__source"
        style={status === 'error' ? undefined : { position: 'absolute', top: 0, left: '-99999px', pointerEvents: 'none' }}
      >
        <ProposalDocument model={model} />
      </div>

      </div>
      </div>
      <style jsx>{`
        .paginated-preview { container-type: inline-size; }
        .paginated-preview__layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; }
        .paginated-preview__document { min-width: 0; }
        .paginated-preview__arrange {
          z-index: 45; padding: 18px; box-sizing: border-box;
          background: var(--nv-surface-card); border: 1px solid var(--nv-border-hair); border-radius: 12px;
          box-shadow: 0 6px 24px rgba(0,0,0,.10); font-size: 13px;
          display: flex; flex-direction: column; gap: 12px;
          max-height: calc(100dvh - 32px); overflow-y: auto;
        }
        .paginated-preview__arrange h3 { margin: 0; font-size: 14px; font-weight: 700; }
        .paginated-preview__arrange span { overflow-wrap: anywhere; }
        .paginated-preview__actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .paginated-preview__arrange--wide .paginated-preview__actions { flex-direction: column; }
        .paginated-preview__arrange small { color: var(--nv-text-muted); line-height: 1.5; }
        .paginated-preview__section-breaks { border-top: 1px solid var(--nv-border-hair); padding-top: 12px; }
        .paginated-preview__section-breaks summary { cursor: pointer; font-weight: 600; }
        .paginated-preview__breaks {
          display: flex; flex-direction: column; gap: 10px;
          padding-top: 12px; font-size: 12px; color: var(--nv-text-body);
        }
        .paginated-preview__breaks-label { color: var(--nv-text-muted); }
        .paginated-preview__break-toggle { display: inline-flex; align-items: flex-start; gap: 8px; cursor: pointer; }
        .paginated-preview__break-toggle input { accent-color: var(--nv-blue-slate); cursor: pointer; margin-top: 2px; }
        @container (min-width: 900px) {
          .paginated-preview__layout--editable { grid-template-columns: minmax(0, 1fr) 240px; gap: 24px; }
          .paginated-preview__layout--editable .paginated-preview__document { grid-column: 1; grid-row: 1; }
          .paginated-preview__controls-slot { grid-column: 2; grid-row: 1; }
        }
        .paginated-preview__banner {
          font-size: 13px; color: var(--nv-text-muted); text-align: center; padding: 10px 0 16px;
        }
        .paginated-preview__banner--error {
          color: var(--nv-error); background: rgba(152,38,73,0.08); border: 1px solid var(--nv-error);
          border-radius: 8px; padding: 10px 14px; text-align: left;
        }
        .paginated-preview__source { max-width: 100%; overflow-x: auto; }
        :global(.paginated-preview__pages) { border-radius: 12px; overflow-x: auto; background: #e5e7eb; }
        :global(.paginated-preview__iframe) {
          display: block; width: 100%; min-width: calc(210mm + 32px); border: 0; min-height: 200px;
        }
      `}</style>
    </div>
  )
}
