'use client'

import React, { useEffect, useRef, useState } from 'react'
import { ProposalDocument } from './ProposalDocument'
import { TinyMcePageEditor } from './TinyMcePageEditor'
import type { ProposalDocModel } from '@/lib/documentModel'
import { pageId, readA4Document, sanitizePageHtml, type A4Document, type A4Page } from '@/lib/a4Document'

/** Fast, approximate page-count estimate shown the instant the source
 *  content is ready — before the accurate chunker below (which runs a
 *  binary-search split on any oversized paragraph) has had a chance to lay
 *  out real pages. Walks the exact same doc-cover/doc-letter/doc-flow
 *  structure the accurate chunker does, using the same scrollHeight-vs-
 *  clientHeight measurement against a real `.a4-sheet`, but skips the
 *  expensive per-paragraph binary search: an oversized block just starts
 *  its own page outright. That makes this a few-page-accurate estimate,
 *  not a guaranteed-exact one — which is the point: it exists to answer
 *  "roughly how long will this proposal be" right away, and gets replaced
 *  by the real, exact page list moments later. */
function estimatePageCount(source: Element): number {
  const measurement = document.createElement('div')
  measurement.className = 'a4-sheet'
  measurement.style.cssText = 'position:absolute;left:-100000px;top:0;'
  document.body.appendChild(measurement)
  try {
    let count = 0
    let chunks: string[] = []
    function flush() {
      if (!chunks.length) return
      count++
      chunks = []; measurement.innerHTML = ''
    }
    function add(el: Element) {
      if (el.tagName === 'STYLE') return
      if (el.classList.contains('doc-cover')) { flush(); count++; return }
      if (el.classList.contains('doc-letter')) { flush(); Array.from(el.children).forEach(add); flush(); return }
      if (['doc-flow', 'doc-section', 'doc-service-block'].some(c => el.classList.contains(c))) { Array.from(el.children).forEach(add); return }
      const html = el.outerHTML
      measurement.innerHTML = chunks.join('') + html
      if (measurement.scrollHeight > measurement.clientHeight + 2 && chunks.length) flush()
      chunks.push(html); measurement.innerHTML = chunks.join('')
      if (measurement.scrollHeight > measurement.clientHeight + 2 && chunks.length > 1) {
        chunks.pop(); flush(); chunks.push(html); measurement.innerHTML = html
      }
    }
    Array.from(source.children).forEach(add)
    flush()
    return Math.max(count, 1)
  } finally { measurement.remove() }
}

export function A4DocumentEditor({ model, onChange, onReady }: {
  model: ProposalDocModel
  onChange: (value: A4Document) => void
  onReady: (ready: boolean) => void
}) {
  const initialModel = useRef(model).current
  const pendingFocus = useRef<string | null>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const pageList = useRef<A4Page[]>([])
  const changeRef = useRef(onChange); changeRef.current = onChange
  const readyRef = useRef(onReady); readyRef.current = onReady
  const [pages, setPages] = useState<A4Page[]>([])
  const [estimatedPages, setEstimatedPages] = useState<number | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [overflow, setOverflow] = useState<string[]>([])
  const [error, setError] = useState('')
  const rangeRef = useRef<Range | null>(null)
  const activeRef = useRef<string | null>(null)

  function checkOverflow() {
    const ids = pageList.current.filter(p => { const el = nodes.current.get(p.id); return el && el.scrollHeight > el.clientHeight + 2 }).map(p => p.id)
    // Bail out with the SAME array reference when the overflowing-page set is
    // unchanged. checkOverflow runs very often (a ResizeObserver on every
    // mounted page, plus 'load'/'error' listeners on every image), so without
    // this guard setOverflow(ids) would hand React a brand-new array on every
    // call and force a re-render each time, even when nothing actually changed.
    setOverflow(previous => previous.length === ids.length && previous.every((id, i) => id === ids[i]) ? previous : ids)
    const imagesLoading = Array.from(nodes.current.values()).some(el => Array.from(el.querySelectorAll('img')).some(img => !img.complete))
    readyRef.current(pageList.current.length > 0 && ids.length === 0 && !imagesLoading)
  }
  function pageOverflows(node: HTMLElement) { return node.scrollHeight > node.clientHeight + 2 }
  // A moved block can carry the live caret with it (typing right at the
  // bottom of a page that just overflowed). Re-locate whichever mounted page
  // now contains the remembered Range and refocus there so typing continues
  // uninterrupted instead of the cursor silently detaching.
  function resyncFocusAfterMove() {
    const range = rangeRef.current
    if (!range || !range.startContainer.isConnected) return
    for (const [id, node] of nodes.current) {
      if (!node.contains(range.startContainer)) continue
      if (activeRef.current !== id) { activeRef.current = id; setActive(id) }
      if (document.activeElement !== node) {
        node.focus({ preventScroll: true })
        const selection = window.getSelection()
        selection?.removeAllRanges(); selection?.addRange(range)
      }
      break
    }
  }
  // Re-read every mounted page's live DOM content into pageList.current
  // before any commit() that RESTRUCTURES the page array (inserts/removes a
  // page). Without this, commit()'s next setPages(next) can hand a freshly
  // mounted page an html snapshot that's stale by however many keystrokes
  // happened since the last full publish() — invisible for pages that stay
  // mounted (TinyMcePageEditor never re-renders once mounted), but a real
  // bug for whichever page's DOM gets torn down and rebuilt by the
  // restructure. This is the fix for the "typed content disappears during
  // reflow" issue that had reflow disabled entirely before this pass.
  function syncFromDom() {
    pageList.current = pageList.current.map(p => {
      const node = nodes.current.get(p.id)
      return node ? { ...p, html: sanitizePageHtml(node.innerHTML) } : p
    })
  }
  // Push a page's overflowing tail content onto the following page, creating
  // one when needed — continuous, Word-style pagination instead of getting
  // stuck behind the "content exceeds A4" warning until a manual move.
  // Never pushes into a page the user deliberately started fresh with
  // (breakBefore) — a new page is inserted ahead of it instead.
  function reflowForward(): 'restructured' | 'done' {
    let guard = 0
    let i = 0
    while (i < pageList.current.length && guard < 300) {
      const page = pageList.current[i]
      const node = page.kind === 'cover' ? undefined : nodes.current.get(page.id)
      if (!node || !pageOverflows(node)) { i++; continue }
      const lastChild = node.lastElementChild
      if (!lastChild || node.children.length <= 1) { i++; continue }
      guard++
      const dest = pageList.current[i + 1]
      if (!dest || dest.kind === 'cover' || dest.breakBefore) {
        syncFromDom()
        const fresh: A4Page = { id: pageId(), kind: 'body', html: '<p><br></p>', breakBefore: false }
        const next = [...pageList.current]; next.splice(i + 1, 0, fresh)
        commit(next)
        return 'restructured'
      }
      const destNode = nodes.current.get(dest.id)
      if (!destNode) return 'restructured'
      destNode.insertBefore(lastChild, destNode.firstChild)
      resyncFocusAfterMove()
    }
    return 'done'
  }
  // Pull content back up from a following page to fill a page that has room,
  // so deleting text compacts the document again instead of leaving a gap.
  // Stops at (never pulls across) a page the user deliberately started fresh.
  function reflowBackward(): 'restructured' | 'done' {
    let guard = 0
    for (let i = 0; i < pageList.current.length - 1 && guard < 300; i++) {
      const page = pageList.current[i]
      if (page.kind === 'cover') continue
      const node = nodes.current.get(page.id)
      if (!node || pageOverflows(node)) continue
      while (guard < 300) {
        const next = pageList.current[i + 1]
        if (!next || next.kind === 'cover' || next.breakBefore) break
        const nextNode = nodes.current.get(next.id)
        if (!nextNode) break
        const firstChild = nextNode.firstElementChild
        if (!firstChild) {
          if (pageList.current.length > 1 && !nextNode.textContent?.trim()) {
            guard++
            syncFromDom()
            const filtered = pageList.current.filter(p => p.id !== next.id)
            nodes.current.delete(next.id)
            commit(filtered)
            return 'restructured'
          }
          break
        }
        guard++
        node.appendChild(firstChild)
        if (pageOverflows(node)) { nextNode.insertBefore(firstChild, nextNode.firstChild); break }
        resyncFocusAfterMove()
      }
    }
    return 'done'
  }
  function reflow(): 'restructured' | 'done' {
    const forwarded = reflowForward()
    if (forwarded === 'restructured') return forwarded
    return reflowBackward()
  }
  function publish() {
    if (reflow() === 'restructured') return
    const next = pageList.current.map(p => ({ ...p, html: sanitizePageHtml(nodes.current.get(p.id)?.innerHTML ?? p.html) }))
    pageList.current = next
    changeRef.current({ version: 1, pages: next })
    checkOverflow()
  }
  function register(id: string, node: HTMLElement | null) {
    if (node) nodes.current.set(id, node); else nodes.current.delete(id)
  }
  function commit(next: A4Page[]) {
    readyRef.current(false)
    pageList.current = next
    setPages(next)
  }

  useEffect(() => {
    let cancelled = false
    readyRef.current(false)
    sourceRef.current?.setAttribute('inert', '')
    async function initialise() {
      try {
        await document.fonts.ready
        if (cancelled || !sourceRef.current) return
        const saved = readA4Document(initialModel.pageBreaks)
        if (saved) { commit(saved.pages.map(p => ({ ...p, html: sanitizePageHtml(p.html) }))); return }
        const source = sourceRef.current.querySelector('#proposal-print-root')!
        await Promise.all(Array.from(source.querySelectorAll('img')).map(img => img.decode().catch(() => {})))
        if (cancelled) return
        setEstimatedPages(estimatePageCount(source))
        if (cancelled) return
        // Fill real A4 containers once; subsequent edits never rebuild the pages.
        const measurement = document.createElement('div')
        measurement.className = 'a4-sheet'
        measurement.style.cssText = 'position:absolute;left:-100000px;top:0;'
        document.body.appendChild(measurement)
        try {
          const result: A4Page[] = []
          let chunks: string[] = []
          let hardBreakPending = false
          function flush() {
            if (!chunks.length) return
            result.push({ id: pageId(), kind: 'body', html: sanitizePageHtml(chunks.join('')), breakBefore: hardBreakPending })
            hardBreakPending = false
            chunks = []; measurement.innerHTML = ''
          }
          function add(el: Element) {
            if (el.tagName === 'STYLE') return
            if (el.classList.contains('doc-cover')) { flush(); result.push({ id: pageId(), kind: 'cover', html: sanitizePageHtml(el.outerHTML) }); return }
            if (el.classList.contains('doc-letter')) {
              flush(); Array.from(el.children).forEach(add); flush()
              // Wall between the letter and whatever follows it: the very
              // next page created after this point gets breakBefore:true,
              // so reflowBackward can never later pull Background/Scope/etc.
              // content up into the letter page once it has room, and the
              // letter always stays its own standalone page 2.
              hardBreakPending = true
              return
            }
            if (['doc-flow','doc-section','doc-service-block'].some(c => el.classList.contains(c))) { Array.from(el.children).forEach(add); return }
            const html = sanitizePageHtml(el.outerHTML)
            measurement.innerHTML = chunks.join('') + html
            if (measurement.scrollHeight > measurement.clientHeight + 2 && chunks.length) flush()
            chunks.push(html); measurement.innerHTML = chunks.join('')
            // An oversized rich-text block can be split at existing paragraphs.
            if (measurement.scrollHeight > measurement.clientHeight + 2 && el.children.length > 1 && !['TABLE','SVG','UL','OL'].includes(el.tagName)) {
              chunks.pop(); measurement.innerHTML = chunks.join(''); Array.from(el.children).forEach(add)
            } else if (measurement.scrollHeight > measurement.clientHeight + 2 && !['SVG','IMG'].includes(el.tagName)) {
              // Split an oversized paragraph/table without discarding text or inline formatting.
              // This happens only during initial placement, never on an editing keystroke.
              const container = document.createElement('div'); container.innerHTML = html
              const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
              const textNodes: Text[] = []; let current: Node | null
              while ((current = walker.nextNode())) textNodes.push(current as Text)
              const text = container.textContent || ''
              function boundary(offset: number): [Node, number] {
                for (const node of textNodes) {
                  if (offset <= node.length) return [node, offset]
                  offset -= node.length
                }
                return [container, container.childNodes.length]
              }
              function fragment(start: number, end: number): string {
                const range = document.createRange()
                if (start === 0) range.setStart(container, 0); else range.setStart(...boundary(start))
                if (end === text.length) range.setEnd(container, container.childNodes.length); else range.setEnd(...boundary(end))
                const box = document.createElement('div'); box.appendChild(range.cloneContents()); return box.innerHTML
              }
              let low = 0, high = text.length
              while (low < high) {
                const middle = Math.ceil((low + high) / 2)
                measurement.innerHTML = fragment(0, middle)
                if (measurement.scrollHeight <= measurement.clientHeight + 2) low = middle; else high = middle - 1
              }
              const wordEnd = text.lastIndexOf(' ', low - 1)
              const cut = wordEnd > low / 2 ? wordEnd + 1 : low
              if (cut > 0 && cut < text.length) {
                chunks.pop(); chunks.push(fragment(0, cut)); flush()
                const rest = document.createElement('div'); rest.innerHTML = fragment(cut, text.length)
                Array.from(rest.children).forEach(add)
              } else measurement.innerHTML = chunks.join('')
            }
          }
          Array.from(source.children).forEach(add); flush()
          commit(result.length ? result : [{ id: pageId(), kind: 'body', html: '<p><br></p>' }])
        } finally { measurement.remove() }
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare document pages') }
    }
    initialise()
    return () => { cancelled = true }
    // This is an editing session: changing the draft must not replace the live DOM/caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!pages.length) return
    publish()
    const observer = new ResizeObserver(checkOverflow)
    const mountedNodes = Array.from(nodes.current.values())
    mountedNodes.forEach(node => { observer.observe(node); node.addEventListener('load', checkOverflow, true); node.addEventListener('error', checkOverflow, true) })
    const target = pendingFocus.current ? nodes.current.get(pendingFocus.current) : null
    if (target) {
      target.focus({ preventScroll: true })
      const range = document.createRange(); range.selectNodeContents(target); range.collapse(true)
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
      rangeRef.current = range; target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      pendingFocus.current = null
    }
    return () => { observer.disconnect(); mountedNodes.forEach(node => { node.removeEventListener('load', checkOverflow, true); node.removeEventListener('error', checkOverflow, true) }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages])

  useEffect(() => {
    function rememberSelection() {
      const selection = window.getSelection()
      if (!selection?.rangeCount) return
      const range = selection.getRangeAt(0)
      for (const [id, node] of nodes.current) {
        if (node.contains(range.commonAncestorContainer)) { rangeRef.current = range.cloneRange(); activeRef.current = id; setActive(id); break }
      }
    }
    document.addEventListener('selectionchange', rememberSelection)
    return () => document.removeEventListener('selectionchange', rememberSelection)
  }, [])

  function focusPage(id: string) { activeRef.current = id; setActive(id) }
  function addPage() {
    const selected = pageList.current.findIndex(p => p.id === activeRef.current)
    const index = selected < 0 ? pageList.current.length : selected + 1
    syncFromDom()
    const page: A4Page = { id: pageId(), kind: 'body', html: '<p><br></p>', breakBefore: true }
    const next = [...pageList.current]; next.splice(index, 0, page); pendingFocus.current = page.id; commit(next); focusPage(page.id)
  }
  function moveContent(direction: -1 | 1, splitAtCursor = false) {
    const id = activeRef.current
    const from = id ? nodes.current.get(id) : null
    const range = rangeRef.current
    if (!from || !range || !from.contains(range.commonAncestorContainer)) return
    const index = pageList.current.findIndex(p => p.id === id)
    if (pageList.current[index]?.kind === 'cover') return
    if (direction === -1 && index <= 0) return
    if (direction === -1 && pageList.current[index - 1]?.kind === 'cover') return
    let html: string
    if (splitAtCursor) {
      const tail = document.createRange(); tail.setStart(range.startContainer, range.startOffset); tail.setEnd(from, from.childNodes.length)
      const box = document.createElement('div'); box.appendChild(tail.extractContents()); html = box.innerHTML
    } else {
      let block: Node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentNode!
      while (block.parentNode && block.parentNode !== from) block = block.parentNode
      if (block === from) return
      const box = document.createElement('div'); box.appendChild(block); html = box.innerHTML
    }
    syncFromDom()
    const next = pageList.current.slice()
    let target = next[index + direction]
    if (!target || (direction === 1 && target.kind === 'cover')) {
      target = { id: pageId(), kind: 'body', html: '', breakBefore: splitAtCursor }; next.splice(index + 1, 0, target)
    }
    if (target.kind === 'cover') { setError('Move body content to a body page, not the cover.'); return }
    const destination = nodes.current.get(target.id)
    if (destination) {
      destination.insertAdjacentHTML(direction === 1 ? 'afterbegin' : 'beforeend', sanitizePageHtml(html))
      target.html = sanitizePageHtml(destination.innerHTML)
    } else target.html = sanitizePageHtml(html) || '<p><br></p>'
    // Existing sheets remain mounted and retain their editor history.
    pendingFocus.current = target.id
    commit(next); focusPage(target.id); rangeRef.current = null
  }
  function removeEmptyPage() {
    const id = activeRef.current; const node = id ? nodes.current.get(id) : null
    if (!node || node.textContent?.trim() || node.querySelector('img,svg,table') || pageList.current.length <= 1) return
    syncFromDom()
    commit(pageList.current.filter(p => p.id !== id)); setActive(null); activeRef.current = null
  }

  return <div className="a4-editor">
    <div className="a4-editor__document">
      {error && <p role="alert">{error}</p>}
      {!pages.length && !error && (
        <p>{estimatedPages ? `Estimated ~${estimatedPages} A4 page${estimatedPages === 1 ? '' : 's'} — laying out your editable pages…` : 'Estimating pages…'}</p>
      )}
      {pages.map((page, index) => <div className="a4-editor__page" key={page.id}>
        <TinyMcePageEditor
          page={page}
          onNode={register}
          onDirty={publish}
          onFocus={focusPage}
          onBreak={() => moveContent(1, true)}
          onMoveNext={() => moveContent(1)}
          onMovePrev={() => moveContent(-1)}
          onAddPage={addPage}
          onRemovePage={removeEmptyPage}
        />
        <div className="a4-editor__caption">
          Page {index + 1}{overflow.includes(page.id) ? <span className="a4-editor__warning"> — content exceeds A4, move some to another page</span> : null}
        </div>
      </div>)}
    </div>
    <div ref={sourceRef} className="a4-editor__source" aria-hidden="true"><ProposalDocument model={initialModel} ignorePageLayout /></div>
    <style jsx>{`
      .a4-editor__document { min-width: 0; overflow-x: auto; background: #e5e7eb; padding: 24px 16px; border-radius: 12px; }
      .a4-editor__page { width: 210mm; margin: 0 auto 24px; }
      .a4-editor__caption { text-align: center; padding: 10px; font-size: 12px; color: #6b7280; }
      .a4-editor__warning { color: var(--nv-error); }
      .a4-editor__source { position: absolute; left: -100000px; top: 0; width: 210mm; pointer-events: none; }
      /* TinyMCE's inline editors only ever render <div id tabIndex> before
         init (see TinyMcePageEditor.tsx's own comment) — this keeps that
         placeholder at real A4 proportions from the very first paint,
         instead of collapsing to its (empty) content height for the brief
         moment before TinyMCE attaches and applies the .a4-sheet class
         itself. Page ids are always "page-<uuid>" (a4Document.ts's
         pageId()), so this can't match anything outside this editor. */
      .a4-editor__page :global([id^='page-']) { width: 210mm; min-height: 297mm; box-sizing: border-box; }
    `}</style>
  </div>
}
