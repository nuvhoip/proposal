'use client'

import React, { useEffect, useRef, useState } from 'react'
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

export function PaginatedPreview({ model, onTogglePageBreak }: {
  model: ProposalDocModel
  onTogglePageBreak?: (sectionKey: string, checked: boolean) => void
}) {
  const sourceRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tokenRef = useRef(0)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [status, setStatus] = useState<'measuring' | 'ready' | 'error'>('measuring')

  // JSON.stringify(model) as a dependency key: this is only recomputed once
  // per debounced pagination pass below (never per keystroke directly), and
  // model is plain, JSON-safe data (strings/numbers/booleans/arrays), so
  // this is a cheap and correct way to re-paginate whenever any part of the
  // document actually changes, without hand-listing every field that could
  // affect layout.
  const modelKey = JSON.stringify(model)

  useEffect(() => {
    let cancelled = false
    const token = ++tokenRef.current
    setStatus('measuring')
    let activeIframe: HTMLIFrameElement | null = null

    function cleanupIframe() {
      window.removeEventListener('message', onMessage)
      if (activeIframe && activeIframe.parentNode) {
        activeIframe.parentNode.removeChild(activeIframe)
      }
      activeIframe = null
    }

    function onMessage(event: MessageEvent) {
      if (!activeIframe || event.source !== activeIframe.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return

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
          { type: 'pagedjs-render', content: rootEl ? rootEl.outerHTML : '' },
          '*',
        )
        return
      }

      if (data.type === 'pagedjs-done') {
        if (cancelled || token !== tokenRef.current || !activeIframe) return
        activeIframe.style.height = `${Math.ceil(data.height) + 1}px`
        setPageCount(typeof data.total === 'number' ? data.total : null)
        setStatus('ready')
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
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: 24px 0; background: #F5F8F9; }
  .pagedjs_page { background: white; box-shadow: 0 2px 8px rgba(40,104,127,0.15); flex-shrink: 0; }
</style>
</head><body>
<div id="target"></div>
<script>
  (function () {
    function post(msg) { window.parent.postMessage(msg, '*'); }
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || data.type !== 'pagedjs-render') return;
      (async function () {
        try {
          var target = document.getElementById('target');
          target.innerHTML = '';
          var previewer = new window.Paged.Previewer();
          var flow = await previewer.preview(data.content, ['/print-rules.css', '/print-rules-preview-overrides.css'], target);
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
  }, [modelKey])

  const visibleSections = getVisibleSections(model)

  return (
    <div className="paginated-preview">
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
          This document will print as <strong>{pageCount}</strong> page{pageCount === 1 ? '' : 's'}.
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

      <style jsx>{`
        .paginated-preview__breaks {
          display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px;
          background: var(--nv-surface-card); border: 1px solid var(--nv-border-hair); border-radius: 10px;
          padding: 12px 16px; margin-bottom: 16px; font-size: 13px; color: var(--nv-text-body);
        }
        .paginated-preview__breaks-label { color: var(--nv-text-muted); margin-right: 4px; }
        .paginated-preview__break-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
        .paginated-preview__break-toggle input { accent-color: var(--nv-blue-slate); cursor: pointer; }
        .paginated-preview__banner {
          font-size: 13px; color: var(--nv-text-muted); text-align: center; padding: 10px 0 16px;
        }
        .paginated-preview__banner--error {
          color: var(--nv-error); background: rgba(152,38,73,0.08); border: 1px solid var(--nv-error);
          border-radius: 8px; padding: 10px 14px; text-align: left;
        }
        .paginated-preview__source { max-width: 100%; overflow-x: auto; }
        :global(.paginated-preview__pages) { border-radius: 12px; overflow: hidden; }
        :global(.paginated-preview__iframe) {
          display: block; width: 100%; border: 0; min-height: 200px;
        }
      `}</style>
    </div>
  )
}
