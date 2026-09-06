'use client'

import { Editor } from '@tinymce/tinymce-react'
import type { Editor as TinyMCEEditor } from 'tinymce'
import React from 'react'
import { sanitizePageHtml, type A4Page } from '@/lib/a4Document'

/**
 * One A4 page's editable surface. Self-hosted TinyMCE running in inline
 * mode: the DOM element TinyMCE attaches to (`editor.getBody()`) becomes
 * the live contentEditable root directly — no iframe, no separate document —
 * so it's the exact same kind of node the old plain `contentEditable` div
 * was, and A4DocumentEditor's DOM-based overflow measurement
 * (scrollHeight/clientHeight) and reflow logic (splicing real child nodes
 * between pages) keep working unchanged against it. Only the editing
 * surface changed; the page/layout model in a4Document.ts did not.
 *
 * Self-hosted via public/tinymce (see scripts/copy-tinymce.mjs, which
 * mirrors node_modules/tinymce there on `npm install`) with licenseKey="gpl":
 * no TinyMCE Cloud account, no API key, no "This domain is not registered"
 * notice.
 *
 * The `@tinymce/tinymce-react` wrapper only ever renders `<div id tabIndex>`
 * for an inline editor (checked its own compiled source — no className/style
 * pass-through), so this component cannot be given the `.a4-sheet` class as
 * a normal React prop. It's applied imperatively in `onInit` instead, once
 * TinyMCE hands back the real element.
 *
 * Memoized to never re-render after mount (comparator always returns
 * true), same reasoning as the old EditableSheet it replaces: once mounted,
 * the live TinyMCE instance owns this page's DOM, and a parent re-render
 * (e.g. an unrelated setOverflow/setActive change elsewhere) must not tear
 * it down or re-apply a stale initialValue over whatever the user has since
 * typed. The callback props below are all safe to freeze at mount time
 * because they close over refs (pageList.current/nodes.current/etc.), not
 * over plain state — see A4DocumentEditor.tsx's own comments on that pattern.
 */
function TinyMcePageEditorImpl({ page, onNode, onDirty, onFocus, onBreak, onMoveNext, onMovePrev, onAddPage, onRemovePage }: {
  page: A4Page
  onNode: (id: string, node: HTMLElement | null) => void
  onDirty: () => void
  onFocus: (id: string) => void
  onBreak: () => void
  onMoveNext: () => void
  onMovePrev: () => void
  onAddPage: () => void
  onRemovePage: () => void
}) {
  return (
    <Editor
      id={page.id}
      inline
      tinymceScriptSrc="/tinymce/tinymce.min.js"
      licenseKey="gpl"
      initialValue={page.html}
      onInit={(_evt, editor) => {
        const node = editor.getBody()
        node.classList.add('a4-sheet', `a4-sheet--${page.kind}`)
        onNode(page.id, node)
      }}
      onRemove={() => onNode(page.id, null)}
      onFocus={() => onFocus(page.id)}
      onEditorChange={() => onDirty()}
      onKeyDown={event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onBreak() }
      }}
      init={{
        menubar: false,
        statusbar: false,
        toolbar_mode: 'wrap',
        plugins: 'lists link autolink table image',
        toolbar: 'bold italic underline | bullist numlist | table link | pagebreak movePrevPage moveNextPage addPageAfter removePage',
        placeholder: 'Start typing…',
        content_style: `
          body { margin: 0; font-family: 'Raleway', Arial, sans-serif; font-size: 13px; line-height: 1.7; color: #1f2b2c; }
          p { margin: 0 0 14px; }
          img { max-width: 100%; }
          table { width: 100%; border-collapse: collapse; }
          td, th { padding: 6px; vertical-align: top; }
        `,
        // Route every paste through the same allowlist sanitizer the rest
        // of the document pipeline uses (a4Document.ts), instead of trusting
        // TinyMCE's own paste cleanup alone — mirrors the old paste() handler's intent.
        setup: (editor: TinyMCEEditor) => {
          editor.on('PastePreProcess', event => { event.content = sanitizePageHtml(event.content) })
          editor.ui.registry.addButton('pagebreak', {
            icon: 'page-break', tooltip: 'Manual page break at cursor (Ctrl/⌘+Enter)',
            onAction: () => onBreak(),
          })
          editor.ui.registry.addButton('movePrevPage', {
            icon: 'chevron-up', tooltip: 'Move this paragraph to the previous page',
            onAction: () => onMovePrev(),
          })
          editor.ui.registry.addButton('moveNextPage', {
            icon: 'chevron-down', tooltip: 'Move this paragraph to the next page',
            onAction: () => onMoveNext(),
          })
          editor.ui.registry.addButton('addPageAfter', {
            icon: 'plus', tooltip: 'Add a blank page after this one',
            onAction: () => onAddPage(),
          })
          editor.ui.registry.addButton('removePage', {
            icon: 'remove', tooltip: 'Remove this page (only works while it’s empty)',
            onAction: () => onRemovePage(),
          })
        },
      }}
    />
  )
}

export const TinyMcePageEditor = React.memo(TinyMcePageEditorImpl, () => true)
