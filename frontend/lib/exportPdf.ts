/* Direct PDF download (2026-10-13) — replaces window.print().
 *
 * The PDF is built from the document preview itself: every A4 page on
 * screen (cover, letter, body pages, the final Client Acceptance page) is
 * rendered to an image with html-to-image and placed full-bleed on its own
 * A4 page with jsPDF. So the PDF is exactly what the preview shows — same
 * pagination, same signature position, a cover with no margin — and the file
 * downloads straight away with no print dialog. Trade-off (agreed with Ody):
 * PDF text is part of the page image, so it isn't selectable/searchable.
 *
 * Elements marked .no-print (the public Accept & Sign form, buttons) are
 * left out, as they were from the old print stylesheet.
 */
import { getFontEmbedCSS, toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

const A4_W_MM = 210
const A4_H_MM = 297
/** Browsers cap canvas height (~16k px in Safari/Chrome); tall pages scale down. */
const MAX_CANVAS_PX = 15000

const isNoPrint = (node: Node) => node instanceof HTMLElement && node.classList.contains('no-print')

/** A card whose only content is .no-print (e.g. the unsigned sign form). */
function onlyNoPrint(el: HTMLElement): boolean {
  if (isNoPrint(el)) return true
  const kids = Array.from(el.children)
  return kids.length > 0 && kids.every(k => isNoPrint(k))
}

/** The page-level boxes of a rendered <ProposalDocument>, in order. */
export function collectPdfPages(root: HTMLElement): HTMLElement[] {
  const pages: HTMLElement[] = []
  const visit = (el: Element) => {
    if (!(el instanceof HTMLElement) || el.tagName === 'STYLE' || onlyNoPrint(el)) return
    if (el.classList.contains('a4-saved-pages')) { Array.from(el.children).forEach(visit); return }
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return
    pages.push(el)
  }
  Array.from(root.children).forEach(visit)
  return pages
}

async function waitForAssets(root: HTMLElement) {
  await document.fonts.ready
  await Promise.all(Array.from(root.querySelectorAll('img')).map(img => img.decode().catch(() => {})))
  // Two frames so layout settles after the preview was just revealed.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

export async function exportDocumentPdf(root: HTMLElement, filename: string): Promise<void> {
  await waitForAssets(root)
  const pages = collectPdfPages(root)
  if (!pages.length) throw new Error('Nothing to export — the document preview is empty.')

  const fontEmbedCSS = await getFontEmbedCSS(root).catch(() => '')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  let first = true

  for (const el of pages) {
    const width = el.offsetWidth
    const height = el.scrollHeight
    const pixelRatio = Math.max(1, Math.min(2, MAX_CANVAS_PX / height))
    const canvas = await toCanvas(el, {
      pixelRatio, width, height, fontEmbedCSS,
      backgroundColor: '#ffffff',
      filter: node => !isNoPrint(node),
      // Page chrome that only makes sense on screen: card gap, rounded
      // corners, outline/shadow — the PDF page is the sheet edge to edge.
      style: { margin: '0', borderRadius: '0', boxShadow: 'none', maxWidth: 'none' },
    })

    // A page box is A4 already; a taller box (the continuous layout used by
    // proposals without saved A4 pages) is sliced into A4-height pieces.
    const pagePx = Math.round(canvas.width * (A4_H_MM / A4_W_MM))
    for (let top = 0; top < canvas.height - 2; top += pagePx) {
      const sliceH = Math.min(pagePx, canvas.height - top)
      const slice = document.createElement('canvas')
      slice.width = canvas.width; slice.height = sliceH
      const ctx = slice.getContext('2d')!
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, slice.width, slice.height)
      ctx.drawImage(canvas, 0, top, canvas.width, sliceH, 0, 0, canvas.width, sliceH)
      if (!first) pdf.addPage('a4', 'portrait')
      first = false
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_W_MM, A4_W_MM * (sliceH / canvas.width), undefined, 'FAST')
    }
  }
  // Plain anchor download; the object URL is revoked a little later — revoking
  // it in the same tick can make some browsers drop the file name.
  const url = URL.createObjectURL(pdf.output('blob'))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** "ENG-AU-RM-2026-0004 - Harbour Group - Proposal.pdf" (ASCII hyphens: Chrome
 *  drops a download name containing an en dash): first engagement ID
 *  (else the proposal ID), then the client (hotel group, else hotel name). */
export function proposalPdfFileName(parts: { engagementIds?: (string | null | undefined)[]; proposalId?: string | null; client?: string | null }): string {
  const ref = (parts.engagementIds || []).find(Boolean) || parts.proposalId || ''
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const name = [ref, parts.client || '', 'Proposal'].map(p => clean(String(p))).filter(Boolean).join(' - ')
  return `${name || 'Proposal'}.pdf`
}
