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
export function pageId(): string { return `page-${crypto.randomUUID()}` }

/** Allow document formatting, images and the app's SVG logos; never executable markup. */
export function sanitizePageHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tags = new Set('p div span br strong b em i u s strike ul ol li h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr th td hr img a blockquote svg g path circle rect line polyline polygon ellipse defs clippath'.split(' '))
  const attrs = new Set('class title alt colspan rowspan width height viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin fill-rule clip-rule cx cy r x y x1 y1 x2 y2 rx ry points xmlns preserveaspectratio'.split(' '))
  const safeUrl = (value: string, image: boolean) => /^(https?:|\/|#)/i.test(value) || (image ? /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(value) : /^(mailto:|tel:)/i.test(value))
  const styles = new Set('color background-color background-image background-size background-position font-size font-family font-weight font-style text-align text-decoration line-height margin margin-top margin-bottom margin-left margin-right padding padding-top padding-bottom padding-left padding-right width height max-width max-height border border-bottom border-top border-radius --doc-cover-url'.split(' '))
  function clean(parent: Element) {
    for (const el of Array.from(parent.children)) {
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
            if (styles.has(prop) && !/expression|javascript:|@import|behavior|binding/i.test(value) && (!/url\(/i.test(value) || /^url\(["']?(https?:|\/|data:image\/(png|jpeg|jpg|gif|webp);base64,)/i.test(value))) output.style.setProperty(prop, value)
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
  return doc.body.innerHTML
}
