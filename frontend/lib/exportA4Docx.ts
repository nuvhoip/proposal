import { Document, Packer, Paragraph, TextRun, PageBreak, Table, TableRow, TableCell, WidthType, ImageRun } from 'docx'
import { sanitizePageHtml, type A4Document } from './a4Document'

/** Export the authored page contents, rather than regenerating template wording. */
export async function exportA4Docx(value: A4Document): Promise<Blob> {
  const children: (Paragraph | Table)[] = []
  function runs(node: Node, formatting: { bold?: boolean; italics?: boolean; underline?: object } = {}): TextRun[] {
    if (node.nodeType === Node.TEXT_NODE) return [new TextRun({ text: node.textContent || '', ...formatting })]
    if (!(node instanceof Element)) return []
    const tag = node.tagName.toLowerCase()
    if (tag === 'br') return [new TextRun({ break: 1 })]
    const next = { ...formatting }
    if (['b','strong','th'].includes(tag)) next.bold = true
    if (['i','em'].includes(tag)) next.italics = true
    if (tag === 'u') next.underline = {}
    if (node instanceof HTMLElement) {
      if (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) next.bold = true
      if (node.style.fontStyle === 'italic') next.italics = true
      if (node.style.textDecoration.includes('underline')) next.underline = {}
    }
    return Array.from(node.childNodes).flatMap(child => runs(child, next))
  }
  async function imageParagraph(el: Element): Promise<Paragraph> {
    try {
      let data: Uint8Array
      if (el.tagName.toLowerCase() === 'svg') {
        const xml = new XMLSerializer().serializeToString(el)
        const image = new Image()
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
        await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 220
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
        data = new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
      } else {
        const response = await fetch(el.getAttribute('src') || '')
        if (!response.ok) throw new Error('Image could not be loaded')
        data = new Uint8Array(await response.arrayBuffer())
      }
      // Rasterise to PNG to support every image format accepted by the editor.
      const image = new Image()
      const url = URL.createObjectURL(new Blob([data as BlobPart]))
      let png: Uint8Array; let width: number; let height: number
      try {
        image.src = url; await image.decode()
        width = Math.min(600, image.naturalWidth); height = width * image.naturalHeight / image.naturalWidth
        if (height > 900) { width *= 900 / height; height = 900 }
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(width); canvas.height = Math.ceil(height)
        canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
        png = new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
      } finally { URL.revokeObjectURL(url) }
      return new Paragraph({ children: [new ImageRun({ data: png, type: 'png', transformation: { width, height } })] })
    } catch {
      return new Paragraph({ text: el.getAttribute('alt') || '[Document image]' })
    }
  }
  async function blocks(el: Element): Promise<(Paragraph | Table)[]> {
    const tag = el.tagName.toLowerCase()
    if (tag === 'img' || tag === 'svg') return [await imageParagraph(el)]
    if (tag === 'table') {
      const rows = Array.from(el.querySelectorAll('tr')).map(row => new TableRow({ children: Array.from(row.children).filter(c => ['TD','TH'].includes(c.tagName)).map(cell => new TableCell({
        columnSpan: Number(cell.getAttribute('colspan')) || 1,
        children: [new Paragraph({ children: runs(cell) })],
      })) }))
      return rows.length ? [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })] : []
    }
    if (tag === 'ul' || tag === 'ol') return Array.from(el.children).map((li, i) => new Paragraph({
      children: tag === 'ol' ? [new TextRun(`${i + 1}. `), ...runs(li)] : runs(li),
      ...(tag === 'ul' ? { bullet: { level: 0 } } : {}), spacing: { after: 80 },
    }))
    const hasBlocks = Array.from(el.children).some(child => /^(DIV|P|H[1-6]|TABLE|UL|OL|IMG|svg|SVG)$/.test(child.tagName))
    if (hasBlocks) {
      const result: (Paragraph | Table)[] = []
      for (const child of Array.from(el.childNodes)) {
        if (child instanceof Element) result.push(...await blocks(child))
        else if (child.textContent?.trim()) result.push(new Paragraph({ text: child.textContent }))
      }
      return result
    }
    const heading = /^h[1-6]$/.test(tag)
    return [new Paragraph({ children: runs(el, heading ? { bold: true } : {}), spacing: { after: 150 } })]
  }
  for (const [index, page] of value.pages.entries()) {
    if (index) children.push(new Paragraph({ children: [new PageBreak()] }))
    const dom = new DOMParser().parseFromString(sanitizePageHtml(page.html), 'text/html')
    for (const node of Array.from(dom.body.childNodes)) {
      if (node instanceof Element) children.push(...await blocks(node))
      else if (node.textContent?.trim()) children.push(new Paragraph({ text: node.textContent }))
    }
  }
  return Packer.toBlob(new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 850, bottom: 850, left: 794, right: 794 } } }, children }] }))
}
