from pathlib import Path
p=Path('components/proposal/ProposalDocument.tsx');s=p.read_text()
s=s.replace('  const multiSvc =', '''  const block = (key: string, label: string, move?: string[]) => ({
    'data-doc-block': key,
    'data-block-label': label,
    'data-block-move': move ? JSON.stringify(move) : undefined,
    style: model.pageBreaks?.[key] ? { breakBefore: 'page' as const, pageBreakBefore: 'always' as const } : undefined,
  })
  const multiSvc =''',1)
s=s.replace('<div {...field("sender", "message")}', '<div {...block("block:intro", "Introduction")} {...field("sender", "message")}')
s=s.replace('<div className="doc-toc">','<div {...block("block:toc", "Contents")} className="doc-toc">')
s=s.replace('<p>If you require', '<p {...block("block:contact", "Contact paragraph")}>If you require')
s=s.replace('<p>Yours sincerely,</p>','<p {...block("block:signoff", "Sign-off")}>Yours sincerely,</p>')
s=s.replace('<div className="doc-sender">','<div {...block("block:sender", "Sender details")} className="doc-sender">')
s=s.replace('<p>\n                {model.hotelName', '<p {...block("block:background", "Background paragraph")}>\n                {model.hotelName')
s=s.replace('<p>\n                We develop', '<p {...block("block:scope-intro", "Scope introduction")}>\n                We develop')
s=s.replace('<React.Fragment key={it.id}>','<div key={it.id} {...block(`block:scope:${JSON.stringify([s.code, it.id])}`, it.sectionHeading || "Scope item", ["scope", s.code, it.id])}>')
# Only the scope fragment closes immediately after the bullet.
s=s.replace("{it.text || '—'}</div>\n                        </React.Fragment>","{it.text || '—'}</div>\n                        </div>")
s=s.replace('<p {...field("regionSettings", "aboutNuvho")}>', '<p {...block("block:about", "Company description")} {...field("regionSettings", "aboutNuvho")}>')
s=s.replace('<p>\n                The following table', '<p {...block("block:fees-intro", "Pricing introduction")}>\n                The following table')
s=s.replace('<table className="doc-fee-table">','<table {...block("block:fees-table", "Pricing table")} className="doc-fee-table">')
s=s.replace('<div key={f.id} {...field', '<div key={f.id} {...block(`block:footnote:${f.id}`, "Pricing footnote")} {...field')
s=s.replace('<div key={c.id} className="doc-clause">','<div key={c.id} {...block(`block:clause:${c.id}`, c.heading || "Terms clause", ["clause", c.id])} className="doc-clause">')
p.write_text(s)
p=Path('components/proposal/PaginatedPreview.tsx');s=p.read_text()
s=s.replace('onTogglePageBreak, onEdit }','onTogglePageBreak, onEdit, onMoveBlock, layoutRevision = 0 }')
s=s.replace('  model: ProposalDocModel\n','  model: ProposalDocModel\n  onMoveBlock?: (path: string[], direction: -1 | 1) => void\n  layoutRevision?: number\n',1)
s=s.replace('  const sourceRef', '''  const [selection, setSelection] = useState<{ key: string; label: string; move?: string[] } | null>(null)
  const [reflowRevision, setReflowRevision] = useState(0)
  const sourceRef''',1)
s=s.replace("    setStatus('measuring')", "    setStatus('measuring')\n    const scrollY = window.scrollY",1)
s=s.replace("      if (data.type === 'pagedjs-edit') {", """      if (data.type === 'pagedjs-select' && typeof data.key === 'string' && data.key.startsWith('block:')) {
        setSelection({ key: data.key, label: String(data.label || 'Content block'), move: Array.isArray(data.move) ? data.move : undefined })
        return
      }
      if (data.type === 'pagedjs-edit') {""")
s=s.replace("        setStatus('ready')", "        setStatus('ready')\n        if (containerRef.current) containerRef.current.style.minHeight = ''\n        window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior })",1)
s=s.replace("      if (!container) return", "      if (!container) return\n      container.style.minHeight = `${container.getBoundingClientRect().height}px`",1)
s=s.replace("          if (data.editable) {", """          if (data.editable) {
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
            });""")
s=s.replace('  [contenteditable] {', '  [data-selected-block] { outline: 2px dashed #28687f; outline-offset: 4px; }\n  [contenteditable] {')
s=s.replace('  }, [layoutKey])','  }, [layoutKey, layoutRevision, reflowRevision])')
s=s.replace('    <div className="paginated-preview">','''    <div className="paginated-preview">
      {onEdit && (
        <div className="paginated-preview__arrange no-print" role="region" aria-label="Arrange document content">
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
        </div>
      )}''',1)
s=s.replace('        .paginated-preview__breaks {', '''        .paginated-preview__arrange {
          position: sticky; top: 12px; z-index: 20; padding: 12px 16px; margin-bottom: 16px;
          background: var(--nv-surface-card); border: 1px solid var(--nv-border-hair); border-radius: 10px;
          box-shadow: 0 2px 8px rgba(40,104,127,.12); font-size: 13px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .paginated-preview__actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .paginated-preview__arrange small { color: var(--nv-text-muted); }
        .paginated-preview__breaks {''',1)
p.write_text(s)
p=Path('app/(app)/proposals/new/page.tsx');s=p.read_text()
s=s.replace('function Step7Preview({ draft, setDraft, errors, staff = [] }: StepProps) {','''function Step7Preview({ draft, setDraft, errors, staff = [] }: StepProps) {
  const [layoutRevision, setLayoutRevision] = useState(0)
  function moveBlock(path: string[], direction: -1 | 1) {
    // Reorder the same arrays already persisted by the deployed worker.
    function move<T extends { id: string; enabled?: boolean }>(items: T[], id: string) {
      const from = items.findIndex(item => item.id === id)
      if (from < 0) return items
      let to = from + direction
      while (to >= 0 && to < items.length && items[to].enabled === false) to += direction
      if (to < 0 || to >= items.length) return items
      const result = [...items]
      const [item] = result.splice(from, 1)
      result.splice(to, 0, item)
      return result
    }
    setDraft(d => {
      if (path[0] === 'clause') return { ...d, terms: { ...d.terms, clauses: move(d.terms.clauses, path[1]) } }
      if (path[0] === 'scope') return { ...d, services: d.services.map(s => s.code === path[1]
        ? { ...s, scopeItems: move(s.scopeItems, path[2]) } : s) }
      return d
    })
    setLayoutRevision(n => n + 1)
  }''')
s=s.replace('Move freely between fields without refreshing the preview. Save your document below.', 'Select a content block to start it on the next page or remove its page break. Scope items and terms clauses can also move earlier or later in their section. Use Reflow pages after adding text, then save below.')
s=s.replace('onEdit={editField} />','onEdit={editField} onMoveBlock={moveBlock} layoutRevision={layoutRevision} />')
p.write_text(s)
