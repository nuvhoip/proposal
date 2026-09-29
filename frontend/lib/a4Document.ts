/** Page content is stored in the existing page_breaks_json layout envelope.
 * The deployed worker round-trips this JSON, so no server migration is needed. */
export interface A4Page { id: string; kind: 'cover' | 'body'; html: string; breakBefore?: boolean }
export interface A4Document { version: 1; pages: A4Page[] }
export interface PageLayoutSettings {
  [key: string]: boolean | A4Document | undefined
  _document?: A4Document
}
export function readA4Document(settings: PageLayoutSettings): A4Document | null {
  const value = settings?._document
  if (!value || value.version !== 1 || !Array.isArray(value.pages) || !value.pages.length) return null
  const ids = new Set<string>()
  for (const page of value.pages) {
    if (!page || typeof page.id !== 'string' || !page.id || ids.has(page.id) || typeof page.html !== 'string' || !['cover', 'body'].includes(page.kind)) return null
    if (page.breakBefore !== undefined && typeof page.breakBefore !== 'boolean') return null
    ids.add(page.id)
  }
  return value
}
/** True when a heading's text reads as the Terms & Conditions section title.
 * Substring match (entity-decoded, whitespace-collapsed, case-insensitive)
 * so documents saved before the 2026-08-18 change that dropped the
 * "Appendix 1 -" prefix still match. */
export function isTermsHeadingText(raw: string): boolean {
  const text = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return text.includes('terms & conditions') || text.includes('terms and conditions')
}

/** Locate where Terms & Conditions starts in a run of saved A4 pages and,
 * if it starts partway down a page, split that page in two at the heading.
 *
 * Why split rather than just pick a page: the A4 editor paginates by
 * measured height, so the tail of Fee Structure (intro, table, footnotes)
 * and the opening of Terms & Conditions routinely share one saved page.
 * Inserting the public "Accept This Proposal" form before that whole page
 * (the first 2026-09-25 attempt) left the Fee Structure heading above the
 * form and its table below it. Splitting at the heading keeps every piece
 * of Fee Structure above the form and every piece of T&C below it.
 *
 * Saved pages are opaque HTML — sanitizePageHtml() strips `id`s, so the
 * classic branch's `#doc-section-appendix` marker is gone, and the chunker
 * flattens `.doc-section` wrappers — so the heading text is what we match.
 * The split happens at the heading's top-level ancestor inside the page, so
 * both halves stay well-formed HTML.
 *
 * Returns the (possibly one-longer) page list plus `termsIndex`, the index
 * of the page that now OPENS Terms & Conditions — the slot to render an
 * insert in front of. `termsIndex` is -1 when no T&C heading exists (e.g. a
 * hand-edited document that renamed it), and the caller falls back to
 * appending at the end. DOM-based, so client-only (call it from an effect,
 * as A4Pages does). */
export function splitPagesAtTerms(pages: A4Page[]): { pages: A4Page[]; termsIndex: number } {
  if (typeof DOMParser === 'undefined') return { pages, termsIndex: -1 }
  for (let i = 0; i < pages.length; i++) {
    const doc = new DOMParser().parseFromString(pages[i].html, 'text/html')
    const heading = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .find(h => isTermsHeadingText(h.textContent || ''))
    if (!heading) continue

    let top: Element = heading
    while (top.parentElement && top.parentElement !== doc.body) top = top.parentElement

    const before = doc.createElement('div')
    const after = doc.createElement('div')
    let reached = false
    for (const node of Array.from(doc.body.childNodes)) {
      if (node === top) reached = true
      ;(reached ? after : before).appendChild(node)
    }

    const beforeHasContent = !!(before.textContent || '').trim() || !!before.querySelector('img,table,svg,hr')
    if (!beforeHasContent) return { pages, termsIndex: i }

    const next = pages.slice()
    next.splice(i, 1,
      { ...pages[i], id: `${pages[i].id}::pre-terms`, html: before.innerHTML },
      { ...pages[i], id: `${pages[i].id}::terms`, html: after.innerHTML, breakBefore: false },
    )
    return { pages: next, termsIndex: i + 1 }
  }
  return { pages, termsIndex: -1 }
}

/** Replace every saved cover page's HTML with the live cover's, keeping page
 * ids and order. The A4 editor's cover page is never user-editable, so its
 * saved HTML is only ever a snapshot of whichever cover was selected when the
 * layout was first created — refreshing it on load is what lets a cover picked
 * later (or a custom upload that only had a blob: preview URL at snapshot
 * time) actually appear. No-op when there's no live cover or no cover page. */
export function refreshCoverPages(pages: A4Page[], liveCoverHtml: string | null | undefined): A4Page[] {
  if (!liveCoverHtml) return pages
  const html = sanitizePageHtml(liveCoverHtml)
  let changed = false
  const next = pages.map(p => {
    if (p.kind !== 'cover' || p.html === html) return p
    changed = true
    return { ...p, html }
  })
  return changed ? next : pages
}

export function pageId(): string { return `page-${crypto.randomUUID()}` }

/** NUVCL-153: running header on every non-cover A4 page — client name on the
 * left, issue month on the right, over a brand divider — plus a small logo
 * bottom-right. Drawn entirely in CSS (globals.css, `.a4-sheet--body`
 * ::before/::after + background) from these two custom properties, so it is
 * never part of the editable/saved page HTML: it shows on already-saved
 * proposals immediately, can't be typed over or reflowed, and sits inside
 * the existing 15mm page margins so no page's content capacity changes. */
export function pageHeaderVars(clientName: string, dateIssued: string): Record<string, string> {
  const css = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim()}"`
  // dateIssued is en-AU "29 September 2026" — the header shows "September 2026".
  const month = dateIssued.replace(/^\s*\d{1,2}(st|nd|rd|th)?\s+/i, '')
  return { '--a4-header-client': css(clientName || ''), '--a4-header-month': css(month || '') }
}

/** NUVCL-150: TinyMCE injects temporary UI straight into the inline editor's
 * body while an image is selected, resized or dragged — 8 `.mce-resizehandle`
 * divs as soon as the logo is clicked, then a `.mce-resize-backdrop`, a
 * `.mce-resize-helper` size label and a `.mce-clonedresizable` ghost COPY of
 * the image mid-resize (plus `.mce-drag-container`, `.mce-offscreen-selection`,
 * `.mce-visual-caret` in other flows). A4DocumentEditor reads each page's live
 * `innerHTML`, so all of that was being saved into the proposal and treated as
 * real content by reflow (a handle div is the page's lastElementChild, so it
 * got pushed onto the next page, spawning pages and blocking Save). They carry
 * `data-mce-bogus="all"` live, but that attribute is stripped on save, so
 * already-saved copies are matched by class/id too — which also cleans those
 * proposals retroactively on their next load. */
const EDITOR_ARTIFACT_CLASS = /(^|\s)mce-(resizehandle|resize-backdrop|resize-helper|clonedresizable|drag-container|offscreen-selection|visual-caret|pastebin)(\s|$)/
export function isEditorArtifact(el: Element): boolean {
  return el.getAttribute('data-mce-bogus') === 'all'
    || EDITOR_ARTIFACT_CLASS.test(el.getAttribute('class') || '')
    || /^mceResizeHandle/.test(el.id) || el.id === 'mcepastebin'
}
/** Top-level children of a page that are real document content (not TinyMCE's temporary UI). */
export function contentChildren(node: Element): Element[] {
  return Array.from(node.children).filter(child => !isEditorArtifact(child))
}

/** Allow document formatting, images and the app's SVG logos; never executable markup. */
export function sanitizePageHtml(html: string, options: { legacyUpgrades?: boolean } = {}): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tags = new Set('p div span br strong b em i u s strike ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td hr img a blockquote svg g path circle rect line polyline polygon ellipse defs clippath'.split(' '))
  const attrs = new Set('class title alt colspan rowspan width height viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin fill-rule clip-rule cx cy r x y x1 y1 x2 y2 rx ry points xmlns preserveaspectratio'.split(' '))
  // blob: is allowed for images only: it's how the wizard previews a just-uploaded
  // custom cover photo before it's saved to R2. Object URLs are same-origin by
  // construction (a page can't mint one for another origin's data), so they
  // can't smuggle in third-party content — and without this the cover
  // snapshot lost its photo entirely.
  const safeUrl = (value: string, image: boolean) => /^(https?:|\/|#)/i.test(value) || (image ? /^(data:image\/(png|jpeg|jpg|gif|webp);base64,|blob:)/i.test(value) : /^(mailto:|tel:)/i.test(value))
  const styles = new Set('color background-color background-image background-size background-position font-size font-family font-weight font-style text-align text-decoration line-height margin margin-top margin-bottom margin-left margin-right padding padding-top padding-bottom padding-left padding-right width height max-width max-height border border-bottom border-top border-radius --doc-cover-url'.split(' '))
  function clean(parent: Element) {
    for (const el of Array.from(parent.children)) {
      // NUVCL-150: drop TinyMCE's temporary resize/drag UI outright (see isEditorArtifact).
      if (isEditorArtifact(el)) { el.remove(); continue }
      // Any other bogus wrapper (data-mce-bogus="1") is editor scaffolding: keep its children only.
      // Except <br data-mce-bogus="1">: TinyMCE's filler that gives an empty line/cell its
      // height — kept as a plain <br> (the attribute is stripped below) so blank lines survive.
      if (el.hasAttribute('data-mce-bogus') && el.tagName !== 'BR') { clean(el); el.replaceWith(...Array.from(el.childNodes)); continue }
      // doc-heading-row (SectionHeading's wrapper around a section's <h3>,
      // ProposalDocument.tsx) is a `display:flex` row — meant for a "Page
      // Break" checkbox to sit beside the heading in the wizard, which
      // never renders inside the A4 editor's hidden source. Left in place
      // as a live editable block there, pressing Enter inside the <h3>
      // splits it into two <h3> siblings that stay inside that flex row —
      // with no flex-direction set, the second one renders BESIDE the
      // first instead of below it (looks like the new line "indenting" or
      // jumping to the right). Unwrapping it here — on every sanitize call,
      // not just first-load chunking — means this also retroactively fixes
      // a page whose HTML was already saved with the wrapper baked in from
      // before this fix existed, not just newly-chunked documents.
      if (el.tagName === 'DIV' && el.classList.contains('doc-heading-row')) {
        clean(el)
        el.replaceWith(...Array.from(el.childNodes))
        continue
      }
      if (!tags.has(el.tagName.toLowerCase())) {
        if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','LINK','META'].includes(el.tagName)) el.remove()
        else { clean(el); el.replaceWith(...Array.from(el.childNodes)) }
        continue
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (name === 'style') {
          const input = document.createElement('span'); input.setAttribute('style', attr.value)
          const output = document.createElement('span')
          for (const prop of Array.from(input.style)) {
            const value = input.style.getPropertyValue(prop)
            if (styles.has(prop) && !/expression|javascript:|@import|behavior|binding/i.test(value) && (!/url\(/i.test(value) || /^url\(["']?(https?:|\/|data:image\/(png|jpeg|jpg|gif|webp);base64,|blob:)/i.test(value))) output.style.setProperty(prop, value)
          }
          el.setAttribute('style', output.style.cssText)
        } else if (name === 'src' && el.tagName === 'IMG' && safeUrl(attr.value, true)) {
          // Preserve ordinary document images.
        } else if (name === 'href' && el.tagName === 'A' && safeUrl(attr.value, false)) {
          el.setAttribute('rel', 'noopener noreferrer')
        } else if (!attrs.has(name)) el.removeAttribute(attr.name)
      }
      clean(el)
    }
  }
  clean(doc.body)
  // Retroactive NUVCL-151/153 rewrites of old saved pages. Off for signed
  // proposals (A4Pages' `frozen`): an executed contract's document must not
  // change under the client — old Note cells can carry terms like
  // "Includes Room Price Genie & Revenue 365".
  if (options.legacyUpgrades !== false) {
    upgradeLegacyFeeTables(doc.body)
    upgradeLegacyLetterheadLogo(doc.body)
  }
  return doc.body.innerHTML
}

/** NUVCL-151, retroactive half: pages saved before the fee-table rework have
 * the old `Component | Fee Type | Amount | Months | Note` table and a
 * "Combined monthly total" line baked into their HTML. Because every load,
 * edit and print runs through sanitizePageHtml, dropping them here removes
 * them from the preview, the signing page and the PDF of those proposals too
 * — no rebuild needed. (The new Setup fee column can't be invented from old
 * data; "Rebuild pages from wizard" on Preview & Save regenerates the full
 * new table.) Idempotent: a table without a "Note" header is left alone. */
/** NUVCL-153, retroactive half: the letterhead logo was baked into saved
 * pages at its old 56px default. Bump exactly that default to the new 90px
 * (+60%); a logo someone has since resized by hand is left as they set it. */
const LEGACY_LETTERHEAD_LOGO_PX = 56
export const LETTERHEAD_LOGO_PX = 90
function upgradeLegacyLetterheadLogo(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('.doc-letterhead__logo img').forEach(img => {
    const attr = img.getAttribute('height')
    const styled = img.style.height
    const isLegacy = (attr === String(LEGACY_LETTERHEAD_LOGO_PX) || !attr) && (styled === `${LEGACY_LETTERHEAD_LOGO_PX}px` || !styled)
    if (!isLegacy || (!attr && !styled)) return
    img.setAttribute('height', String(LETTERHEAD_LOGO_PX))
    img.style.height = `${LETTERHEAD_LOGO_PX}px`
    img.style.width = 'auto'
  })
}

function upgradeLegacyFeeTables(root: HTMLElement) {
  root.querySelectorAll('.doc-fee-total').forEach(el => el.remove())
  root.querySelectorAll('table.doc-fee-table').forEach(table => {
    const headRow = table.querySelector('thead tr')
    if (!headRow) return
    const headers = Array.from(headRow.children)
    const label = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const noteIndex = headers.findIndex(h => label(h) === 'note')
    if (noteIndex < 0) return
    headers.forEach(h => {
      if (label(h) === 'amount') h.textContent = 'Fee'
      else if (label(h) === 'months') h.textContent = 'Terms'
    })
    table.querySelectorAll('tr').forEach(row => {
      const cells = Array.from(row.children)
      if (cells.length === 1) {
        // Service group divider row spanning the whole table.
        const span = Number(cells[0].getAttribute('colspan') || '1')
        if (span > 1) cells[0].setAttribute('colspan', String(span - 1))
        return
      }
      if (cells.length === headers.length) cells[noteIndex].remove()
    })
  })
}
