'use client'
import { useEffect, useState } from 'react'
import { sanitizePageHtml, type A4Document } from '@/lib/a4Document'

/** Saved document pages used by the detail, client view and print/PDF paths. */
export function A4Pages({ document: value }: { document: A4Document }) {
  const [pages, setPages] = useState<A4Document['pages']>([])
  useEffect(() => { setPages(value.pages.map(p => ({ ...p, html: sanitizePageHtml(p.html) }))) }, [value])
  return <div className="a4-saved-pages">
    {pages.map(page => <div key={page.id} className={`a4-sheet a4-sheet--${page.kind}`} dangerouslySetInnerHTML={{ __html: page.html }} />)}
  </div>
}
